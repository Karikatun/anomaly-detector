# iOS App Store IAP

This MVP implements iOS App Store subscriptions first. `expo-iap` is only the StoreKit transport in the mobile app; the backend is the entitlement source of truth.

Android billing, offer-code redemption, promotional subscription offers, alternative billing, external purchase links, and Google Play validation are intentionally deferred.

## Runtime Shape

- Mobile fetches configured iOS subscription products through `expo-iap`.
- Purchase requests include `appAccountToken: user.id` and `andDangerouslyFinishTransactionAutomatically: false`.
- Mobile sends the StoreKit signed transaction JWS to the backend.
- Backend verifies signed App Store data with `@apple/app-store-server-library`.
- Backend stores decoded identifiers, entitlement state, and SHA-256 hashes of signed payloads. Do not log or persist raw signed tokens outside request handling.
- Mobile calls `finishTransaction` only after backend verification and entitlement write succeed.
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

Run `npx expo prebuild --clean` only when you intentionally need to inspect generated native projects. Native folders are not stored in this template.

## Webhook

Configure App Store Server Notifications V2 to:

```text
https://<api-domain>/api/webhooks/app-store
```

The endpoint accepts `{ "signedPayload": "..." }`, verifies the signed notification, stores an idempotency hash, and updates the entitlement when it can resolve the user by `appAccountToken` or an existing `originalTransactionId`.

## Restore And Lifecycle

The paywall exposes restore. Restore asks StoreKit for available purchases, sends signed transactions to `POST /api/iap/app-store/reconcile`, and updates the local auth snapshot from backend response.

The app also syncs entitlement on launch and foreground. Profile exposes App Store subscription management for iOS subscriptions.

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
- profile opens App Store subscription management
- webhook replay is idempotent

## Troubleshooting

- Products empty: verify bundle ID, SKU spelling, subscription group status, sandbox tester, real device, and dev-client build.
- `IAP_NOT_CONFIGURED`: backend is missing Apple credentials or root certificates.
- `IAP_INVALID_TRANSACTION`: signed JWS is missing, expired, unverifiable, or product ID is not in `APPLE_IAP_PRODUCT_IDS`.
- `IAP_OWNERSHIP_MISMATCH`: StoreKit transaction `appAccountToken` does not match the authenticated user ID.
- Purchase succeeds but access stays locked: inspect backend logs for verification errors and confirm mobile can reach `EXPO_PUBLIC_API_URL`.
- Works in sandbox but not production: switch `APPLE_IAP_ENVIRONMENT=Production`, set `APPLE_IAP_APP_APPLE_ID`, use production product IDs, and configure production webhooks.

## References

- Expo IAP docs: https://hyochan.github.io/expo-iap/
- Installation: https://hyochan.github.io/expo-iap/getting-started/installation/
- Purchases: https://hyochan.github.io/expo-iap/guides/purchases/
- Subscription flow: https://hyochan.github.io/expo-iap/examples/subscription-flow/
