# iOS App Store IAP

This MVP implements iOS App Store subscriptions first. `expo-iap` is only the StoreKit transport in the mobile app; the backend is the entitlement source of truth.

Android billing, Android code redemption, promotional offer purchase flows, alternative billing, external purchase links, and Google Play validation are intentionally deferred. This document covers the baseline iOS App Store subscription paywall, including App Store offer-code redemption. The paywall may display App Store introductory offer metadata returned with the base subscription products, but that metadata is display-only: Apple decides at purchase time whether the current App Store account is eligible. This MVP does not implement signed promotional-offer purchases.

## Runtime Shape

- Mobile fetches configured iOS subscription products through `expo-iap`.
- Purchase requests include `appAccountToken: user.id` and `andDangerouslyFinishTransactionAutomatically: false`.
- Offer-code redemption opens Apple's native sheet and uses a short-lived backend token so first-time redeemed transactions without `appAccountToken` can be linked only after a user-initiated redemption action.
- Mobile sends the StoreKit signed transaction JWS to the backend.
- Backend verifies signed App Store data with `@apple/app-store-server-library`.
- Backend rejects App Store products that are not listed in `APPLE_IAP_PRODUCT_IDS`; this allowlist is required when IAP verification is configured.
- Backend stores decoded identifiers, entitlement state, and SHA-256 hashes of signed payloads. Do not log or persist raw signed tokens outside request handling.
- Mobile calls `finishTransaction` only after backend verification and entitlement write succeed.
- Restore and foreground sync ingest signed StoreKit purchases through `/transactions`, including non-active unfinished iOS transactions for cleanup, reconcile the last known `originalTransactionId` as a backend fallback, and finish restored StoreKit transactions only after backend ingest succeeds for that exact transaction.
- Mobile uses `useIAP` hook methods and reads the hook-updated available-purchases state for restore and lifecycle reconciliation.
- `GET /api/auth/me` and `GET /api/iap/entitlement` expose the current `premium` subscription snapshot.

## App Store Connect

Create two auto-renewable subscription products in one subscription group:

- monthly SKU, for example `com.example.app.premium.monthly`
- yearly SKU, for example `com.example.app.premium.yearly`

The product IDs must match both backend and mobile env. In sandbox, products may take time to become queryable. Test on a real iOS device with a development build; Expo Go cannot load this native module.

Create sandbox testers in App Store Connect and sign into the sandbox account on the test device only when prompted by StoreKit.

## Apple Server API

Create an App Store Connect API key with access to App Store Server API, then configure backend env:

```bash
APPLE_IAP_BUNDLE_ID=com.example.app
APPLE_IAP_APP_APPLE_ID=1234567890
APPLE_IAP_ENVIRONMENT=Sandbox
APPLE_IAP_ISSUER_ID=...
APPLE_IAP_KEY_ID=...
APPLE_IAP_PRIVATE_KEY_BASE64=...
APPLE_IAP_ROOT_CERTS_DIR=/absolute/path/to/apple/root-certs
APPLE_IAP_PRODUCT_IDS=com.example.app.premium.monthly,com.example.app.premium.yearly
```

`APPLE_IAP_PRIVATE_KEY_BASE64` is the contents of the `.p8` private key encoded as base64, or the PEM text itself for local experiments. Use base64 in shared deployment environments to avoid newline parsing mistakes.

Download Apple root certificates from Apple and point `APPLE_IAP_ROOT_CERTS_DIR` at a directory containing `.cer`, `.crt`, or `.der` files. The default local path is `backend/certs/apple`, but certificates are not committed.

Production verification requires `APPLE_IAP_APP_APPLE_ID`. Sandbox verification does not.

## Mobile Env

Create `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID=com.example.app.premium.monthly
EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID=com.example.app.premium.yearly
```

`EXPO_PUBLIC_*` values are bundled into the app. Never put App Store API keys or private key material in mobile env.

## Development Build

Install a development build on a real iOS device:

```bash
bunx eas-cli build --profile development --platform ios
```

Start the backend and Metro with a LAN-reachable API URL when testing on device:

```bash
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000 bunx expo start --dev-client --host lan
```

`expo-iap` is a native module. EAS development builds run prebuild as part of the build; if you create native projects locally, run `npx expo prebuild --clean` after adding or changing the plugin, then rebuild the dev client. Native folders are not stored in this template.

## Webhook

Configure App Store Server Notifications V2 to:

```text
https://<api-domain>/api/webhooks/app-store
```

The endpoint accepts `{ "signedPayload": "..." }`, verifies the signed notification, stores an idempotency hash, and updates the entitlement when it can resolve the user by `appAccountToken` or an existing `originalTransactionId`.

## Restore And Lifecycle

The paywall exposes restore. Restore asks StoreKit for available purchases, including non-active unfinished iOS transactions, sends each signed App Store transaction to `POST /api/iap/app-store/transactions`, updates the local auth snapshot from backend response, and finishes restored transactions only after backend ingest succeeds for that exact transaction. The last known original transaction ID is sent to `POST /api/iap/app-store/reconcile` as a server-side fallback; this path does not finish local StoreKit purchases.

The app also starts the StoreKit listener on iOS app launch and syncs entitlement on launch and foreground after auth is available. If StoreKit returns no active purchase, the backend can still reconcile the known original transaction ID through App Store Server API. Profile exposes App Store subscription management for iOS subscriptions.

`expo-iap` examples also show `getActiveSubscriptions()` for client-side subscription listing. This MVP does not use it as an access-control source: mobile can use StoreKit available purchases to recover signed transactions, but premium access is always derived from the backend entitlement snapshot after App Store Server verification.

## Error Handling Policy

Mobile treats structured Expo IAP error codes from Expo IAP's `ErrorCode` enum as the source of truth. User cancellations are silent only for the `user-cancelled` code or legacy messages that explicitly say the purchase/payment action was cancelled by the user; generic messages such as payment cancellation are surfaced as failures.

Diagnostics distinguish Expo IAP network-like errors from automatic retryability. Only transient StoreKit or service availability errors are retried automatically: network, remote, interrupted, service-disconnected, and service-error. Billing availability, product-query, initialization, configuration, payment, and ownership errors are shown directly so the user is not kept in a retry loop for a non-retryable condition.

Pending or deferred StoreKit purchases are not sent to backend ingest and are not finished locally. The user sees pending-approval copy until Apple emits a purchased transaction or the backend entitlement changes.

IAP diagnostics include the event name, platform, normalized code, network classification, retryability, message, debug message, response code, product ID, and simple underlying error string when Expo IAP provides them. Diagnostics must not include raw signed transactions, purchase tokens, App Store API credentials, cookies, or other secrets.

## Offer-Code Redemption

The paywall exposes App Store offer-code redemption on iOS. Mobile first calls `POST /api/iap/app-store/offer-code-redemption` to create a short-lived redemption token, then opens `presentCodeRedemptionSheetIOS()`. If StoreKit later publishes a redeemed purchase without `appAccountToken`, mobile sends the signed transaction with that redemption token to `POST /api/iap/app-store/transactions`.

The backend still verifies the App Store signed transaction, enforces `APPLE_IAP_PRODUCT_IDS`, stores only decoded identifiers plus signed-payload hashes, and rejects tokenless first claims unless the authenticated user has a valid redemption token. Normal purchases continue to require `appAccountToken: user.id` or an already-linked `originalTransactionId`.

## Deferred Billing Surfaces

Alternative billing, external purchase links, signed promotional-offer purchase flows, Android billing, Android code redemption, and Android entitlement validation are not part of this MVP. Do not expose Android redemption until the product scope includes a dedicated Play Billing validation path.

The basic `expo-iap` config plugin can still add native billing capabilities for both platforms when a native Android build is generated. Android user-facing billing remains disabled in this app until a dedicated Play Billing implementation is added.

Before enabling alternative billing or external purchase links, update product scope and implementation together:

- obtain the required Apple or Google approval for each country and billing mode;
- configure `expo-iap` alternative-billing plugin options intentionally, including iOS external purchase countries, entitlements, and HTTPS external URLs without query parameters;
- implement deep-link return handling and clear user copy that the user is leaving the app for external payment;
- add backend validation for externally completed purchases before granting premium access;
- for Android billing programs, choose the exact Google Play mode, collect the required reporting token, and report it to Google within the required window.

## Validation

Automated checks:

```bash
bun run test:contracts
bun run test:backend
bun run test:mobile
bun run typecheck
```

Manual sandbox checks on a real iOS development build:

- inactive authenticated user lands on `/paywall`
- monthly/yearly products load from App Store Connect
- purchase sends `appAccountToken` and does not auto-finish
- backend verifies transaction and activates `/components`
- restore rehydrates entitlement after reinstall/logout/login
- restored transactions are not finished before backend reconciliation succeeds
- App Store offer-code redemption opens the native sheet and a redeemed transaction unlocks only after backend verification
- profile opens App Store subscription management
- webhook replay is idempotent

## Troubleshooting

- Products empty: verify bundle ID, SKU spelling, subscription group status, sandbox tester, real iOS device, and rebuilt custom dev-client. Expo Go and iOS Simulator are not reliable purchase test targets.
- `IAP_NOT_CONFIGURED`: backend is missing Apple credentials, root certificates, or required `APPLE_IAP_PRODUCT_IDS`.
- `IAP_INVALID_TRANSACTION`: signed JWS is missing, expired, unverifiable, missing subscription expiry, or product ID is not in `APPLE_IAP_PRODUCT_IDS`.
- `IAP_OWNERSHIP_MISMATCH`: StoreKit transaction `appAccountToken` does not match the authenticated user ID, or a tokenless offer-code redemption claim is missing a valid redemption token.
- Purchase succeeds but access stays locked: inspect backend logs for verification errors and confirm mobile can reach `EXPO_PUBLIC_API_URL`.
- Works in sandbox but not production: switch `APPLE_IAP_ENVIRONMENT=Production`, set `APPLE_IAP_APP_APPLE_ID`, use production product IDs, and configure production webhooks.
- Library issue: check Expo IAP GitHub Issues and the Expo IAP Slack/community support channel linked from the official support page.

## References

- Expo IAP docs: https://hyochan.github.io/expo-iap/
- Installation: https://hyochan.github.io/expo-iap/getting-started/installation/
- Purchases: https://hyochan.github.io/expo-iap/guides/purchases/
- Subscription flow: https://hyochan.github.io/expo-iap/examples/subscription-flow/
- Support: https://hyochan.github.io/expo-iap/guides/support/
