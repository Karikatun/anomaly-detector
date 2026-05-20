import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import type { ExpoPurchaseError, ProductSubscription, Purchase, RequestPurchaseProps } from 'expo-iap';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ExpoIapErrorCode = {
  ActivityUnavailable: 'activity-unavailable',
  AlreadyOwned: 'already-owned',
  AlreadyPrepared: 'already-prepared',
  BillingResponseJsonParseError: 'billing-response-json-parse-error',
  BillingUnavailable: 'billing-unavailable',
  ConnectionClosed: 'connection-closed',
  DeferredPayment: 'deferred-payment',
  DeveloperError: 'developer-error',
  EmptySkuList: 'empty-sku-list',
  FeatureNotSupported: 'feature-not-supported',
  IapNotAvailable: 'iap-not-available',
  InitConnection: 'init-connection',
  Interrupted: 'interrupted',
  ItemNotOwned: 'item-not-owned',
  ItemUnavailable: 'item-unavailable',
  NetworkError: 'network-error',
  NotEnded: 'not-ended',
  NotPrepared: 'not-prepared',
  Pending: 'pending',
  PurchaseError: 'purchase-error',
  PurchaseVerificationFailed: 'purchase-verification-failed',
  PurchaseVerificationFinishFailed: 'purchase-verification-finish-failed',
  PurchaseVerificationFinished: 'purchase-verification-finished',
  QueryProduct: 'query-product',
  ReceiptFailed: 'receipt-failed',
  ReceiptFinished: 'receipt-finished',
  ReceiptFinishedFailed: 'receipt-finished-failed',
  RemoteError: 'remote-error',
  ServiceDisconnected: 'service-disconnected',
  ServiceError: 'service-error',
  SkuNotFound: 'sku-not-found',
  SkuOfferMismatch: 'sku-offer-mismatch',
  SyncError: 'sync-error',
  TransactionValidationFailed: 'transaction-validation-failed',
  Unknown: 'unknown',
  UserCancelled: 'user-cancelled',
  UserError: 'user-error',
} as const;

export function buildSubscriptionPurchaseRequest(productId: string, appAccountToken: string): RequestPurchaseProps {
  if (!uuidPattern.test(appAccountToken)) {
    throw new Error('App Store appAccountToken must be a UUID.');
  }

  return {
    type: 'subs',
    request: {
      apple: {
        sku: productId,
        appAccountToken,
        andDangerouslyFinishTransactionAutomatically: false,
      },
    },
  };
}

export async function ingestAndFinishPurchase({
  finish,
  ingest,
  purchase,
  signedTransactionInfo,
}: {
  finish: (purchase: Purchase) => Promise<void>;
  ingest: (request: { signedTransactionInfo: string }) => Promise<{ subscription: SubscriptionSnapshot }>;
  purchase: Purchase;
  signedTransactionInfo?: string;
}): Promise<{ finishError: unknown | null; subscription: SubscriptionSnapshot }> {
  const transactionInfo = signedTransactionInfo ?? extractSignedTransactionInfo(purchase);
  if (!transactionInfo) {
    throw new Error('App Store purchase is missing signed transaction info.');
  }

  const response = await ingest({ signedTransactionInfo: transactionInfo });
  try {
    await retryIapOperation(() => finish(purchase));
    return { finishError: null, subscription: response.subscription };
  } catch (finishError) {
    return { finishError, subscription: response.subscription };
  }
}

export function buildReconcilePayloadFromPurchases(purchases: Purchase[], originalTransactionIds: string[] = []) {
  const signedTransactions = uniqueStrings(purchases
    .map(extractSignedTransactionInfo)
    .filter((signedTransactionInfo): signedTransactionInfo is string => Boolean(signedTransactionInfo)));
  const originalIds = uniqueStrings(originalTransactionIds);

  return signedTransactions.length > 0 || originalIds.length > 0
    ? {
        ...(signedTransactions.length > 0 ? { signedTransactions } : {}),
        ...(originalIds.length > 0 ? { originalTransactionIds: originalIds } : {}),
      }
    : null;
}

export function extractSignedTransactionInfo(purchase: Purchase) {
  return purchase.purchaseToken?.trim() || null;
}

export function isUserCancelledPurchaseError(error: unknown) {
  return getIapErrorCode(error) === ExpoIapErrorCode.UserCancelled || isLegacyUserCancelledMessage(error);
}

export function isRetryableIapError(error: unknown) {
  return [
    ExpoIapErrorCode.Interrupted,
    ExpoIapErrorCode.NetworkError,
    ExpoIapErrorCode.RemoteError,
    ExpoIapErrorCode.ServiceDisconnected,
    ExpoIapErrorCode.ServiceError,
    ExpoIapErrorCode.BillingUnavailable,
    ExpoIapErrorCode.QueryProduct,
    ExpoIapErrorCode.InitConnection,
  ].includes(getIapErrorCode(error) as never);
}

export function isPostSuccessNoiseError(error: unknown) {
  return getIapErrorCode(error) === ExpoIapErrorCode.ServiceError;
}

export function friendlyIapErrorMessage(error: unknown) {
  const code = getIapErrorCode(error);

  switch (code) {
    case ExpoIapErrorCode.UserCancelled:
      return 'Purchase was cancelled.';
    case ExpoIapErrorCode.DeferredPayment:
    case ExpoIapErrorCode.Pending:
      return 'Purchase is pending approval. Premium will unlock after Apple approves it.';
    case ExpoIapErrorCode.NetworkError:
    case ExpoIapErrorCode.RemoteError:
    case ExpoIapErrorCode.ServiceDisconnected:
    case ExpoIapErrorCode.ServiceError:
    case ExpoIapErrorCode.InitConnection:
    case ExpoIapErrorCode.QueryProduct:
      return 'The App Store is temporarily unavailable. Check your connection and try again.';
    case ExpoIapErrorCode.IapNotAvailable:
    case ExpoIapErrorCode.BillingUnavailable:
    case ExpoIapErrorCode.FeatureNotSupported:
      return 'In-app purchases are not available on this device or account.';
    case ExpoIapErrorCode.ItemUnavailable:
    case ExpoIapErrorCode.SkuNotFound:
      return 'This subscription is not available in the App Store for this account.';
    case ExpoIapErrorCode.ItemNotOwned:
      return 'No restorable App Store subscription was found for this account.';
    case ExpoIapErrorCode.UserError:
      return 'Apple could not complete the purchase. Check your App Store payment settings and try again.';
    case ExpoIapErrorCode.AlreadyOwned:
      return 'This App Store account already owns the subscription. Use Restore purchases.';
    case ExpoIapErrorCode.EmptySkuList:
      return 'Subscription products are not configured correctly.';
    default:
      return 'Subscription is temporarily unavailable. Please try again.';
  }
}

export async function retryIapOperation<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? options.delayMs ?? 300;
  const sleep = options.sleep ?? delay;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableIapError(error)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export function validateAppStorePurchaseForIngest(purchase: Purchase) {
  if (purchase.store !== 'apple') {
    return {
      ok: false as const,
      message: 'This purchase did not come from the App Store.',
      pending: false,
    };
  }

  if (purchase.purchaseState === 'pending') {
    return {
      ok: false as const,
      message: 'Purchase is pending approval. Premium will unlock after Apple approves it.',
      pending: true,
    };
  }

  if (purchase.purchaseState === 'unknown') {
    return {
      ok: false as const,
      message: 'Apple has not confirmed this purchase yet. Please try restore again.',
      pending: false,
    };
  }

  const signedTransactionInfo = extractSignedTransactionInfo(purchase);
  if (!signedTransactionInfo) {
    return {
      ok: false as const,
      message: 'App Store purchase is missing signed transaction info. Use Restore purchases or try again on a real iOS device.',
      pending: false,
    };
  }

  return {
    ok: true as const,
    signedTransactionInfo,
    transactionKey: purchase.transactionId?.trim() || signedTransactionInfo,
  };
}

export function sortProductsByConfiguredOrder(products: ProductSubscription[], productIds: string[]) {
  return [...products].sort((left, right) => {
    const leftIndex = productIds.indexOf(left.id);
    const rightIndex = productIds.indexOf(right.id);
    return normalizedProductIndex(leftIndex) - normalizedProductIndex(rightIndex);
  });
}

export function purchaseButtonLabel(product: ProductSubscription) {
  const offer = introOfferLabel(product);
  return offer ? `${offer}, then ${product.displayPrice}` : `Subscribe for ${product.displayPrice}`;
}

export function introOfferLabel(product: ProductSubscription) {
  const offer =
    product.subscriptionOffers?.find((subscriptionOffer) => subscriptionOffer.type === 'introductory') ??
    ('subscriptionInfoIOS' in product ? product.subscriptionInfoIOS?.introductoryOffer : null);
  if (!offer) return null;

  const period = formatOfferPeriod(offer.periodCount, offer.period?.unit);

  switch (offer.paymentMode) {
    case 'free-trial':
      return period ? `Free trial for ${period}` : 'Free trial available';
    case 'pay-as-you-go':
      return period
        ? `Intro pay-as-you-go price: ${offer.displayPrice} for ${period}`
        : `Intro pay-as-you-go price: ${offer.displayPrice}`;
    case 'pay-up-front':
      return period
        ? `Intro upfront price: ${offer.displayPrice} for first ${period}`
        : `Intro upfront price: ${offer.displayPrice}`;
    default:
      return period ? `Intro offer: ${offer.displayPrice} for ${period}` : `Intro offer: ${offer.displayPrice}`;
  }
}

export function getIapErrorCode(error: unknown) {
  if (typeof error === 'string') return normalizeErrorCode(error);
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as ExpoPurchaseError).code;
  return typeof code === 'string' ? normalizeErrorCode(code) : null;
}

function normalizedProductIndex(index: number) {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeErrorCode(value: string) {
  const code = value.trim();
  const knownCodes = new Set(Object.values(ExpoIapErrorCode));
  if (knownCodes.has(code as never)) return code;

  const normalized = toKebabCase(code);
  if (knownCodes.has(normalized as never)) return normalized;

  if (code.startsWith('E_')) {
    const trimmed = code.slice(2);
    if (knownCodes.has(trimmed as never)) return trimmed;

    const normalizedTrimmed = toKebabCase(trimmed);
    if (knownCodes.has(normalizedTrimmed as never)) return normalizedTrimmed;
  }

  return normalized || ExpoIapErrorCode.Unknown;
}

function isLegacyUserCancelledMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\b(user|purchase|payment)\s+cancell?ed\b|\bcancell?ed\s+by\s+user\b|\buser\s+cancel\b/i.test(message);
}

function toKebabCase(value: string) {
  return value.includes('_')
    ? value
        .split('_')
        .map((word) => word.toLowerCase())
        .join('-')
    : value
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
}

function formatOfferPeriod(value: number | null | undefined, unit: string | null | undefined) {
  if (!value || !unit || unit === 'empty') return null;
  const normalizedUnit = value === 1 ? unit : `${unit}s`;
  return `${value} ${normalizedUnit}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
