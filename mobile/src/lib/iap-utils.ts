import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import type { ExpoPurchaseError, ProductSubscription, Purchase, RequestPurchaseProps } from 'expo-iap';

const userCancelledPurchaseErrorCode = 'user-cancelled';

export function buildSubscriptionPurchaseRequest(productId: string, appAccountToken: string): RequestPurchaseProps {
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
}: {
  finish: (purchase: Purchase) => Promise<void>;
  ingest: (request: { signedTransactionInfo: string }) => Promise<{ subscription: SubscriptionSnapshot }>;
  purchase: Purchase;
}) {
  const signedTransactionInfo = extractSignedTransactionInfo(purchase);
  if (!signedTransactionInfo) {
    throw new Error('App Store purchase is missing signed transaction info.');
  }

  const response = await ingest({ signedTransactionInfo });
  await finish(purchase);
  return response.subscription;
}

export function buildReconcilePayloadFromPurchases(purchases: Purchase[]) {
  const signedTransactions = purchases
    .map(extractSignedTransactionInfo)
    .filter((signedTransactionInfo): signedTransactionInfo is string => Boolean(signedTransactionInfo));

  return signedTransactions.length > 0 ? { signedTransactions } : null;
}

export function extractSignedTransactionInfo(purchase: Purchase) {
  return purchase.purchaseToken?.trim() || null;
}

export function isUserCancelledPurchaseError(error: unknown) {
  return (
    isErrorCode(error, userCancelledPurchaseErrorCode) ||
    (error instanceof Error && error.message.toLowerCase().includes('cancel'))
  );
}

export function processPurchaseResult(
  result: Purchase | Purchase[] | null,
  handlePurchase: (purchase: Purchase) => Promise<void>,
) {
  if (!result) return Promise.resolve();
  const purchases = Array.isArray(result) ? result : [result];
  return Promise.all(purchases.map(handlePurchase)).then(() => undefined);
}

export function sortProductsByConfiguredOrder(products: ProductSubscription[], productIds: string[]) {
  return [...products].sort((left, right) => {
    const leftIndex = productIds.indexOf(left.id);
    const rightIndex = productIds.indexOf(right.id);
    return normalizedProductIndex(leftIndex) - normalizedProductIndex(rightIndex);
  });
}

function normalizedProductIndex(index: number) {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isErrorCode(error: unknown, code: string) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return (error as ExpoPurchaseError).code === code;
}
