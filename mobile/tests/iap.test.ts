import { expect, test } from 'bun:test';

const {
  buildReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  extractSignedTransactionInfo,
  ingestAndFinishPurchase,
  isUserCancelledPurchaseError,
} = await import('../src/lib/iap-utils');

const activeSubscription = {
  entitlement: 'premium' as const,
  isActive: true,
  state: 'active' as const,
  platform: 'ios' as const,
  productId: 'premium_monthly',
  originalTransactionId: 'original-1',
  transactionId: 'transaction-1',
  expiresAt: '2026-06-19T00:00:00.000Z',
  willAutoRenew: true,
  updatedAt: '2026-05-19T00:00:00.000Z',
};

test('builds iOS subscription purchase requests with backend-owned finishing', () => {
  expect(buildSubscriptionPurchaseRequest('premium_monthly', 'user-uuid')).toEqual({
    type: 'subs',
    request: {
      apple: {
        sku: 'premium_monthly',
        appAccountToken: 'user-uuid',
        andDangerouslyFinishTransactionAutomatically: false,
      },
    },
  });
});

test('extracts signed App Store transaction info from purchase tokens', () => {
  expect(extractSignedTransactionInfo({ purchaseToken: ' signed-jws ' } as never)).toBe('signed-jws');
  expect(extractSignedTransactionInfo({ purchaseToken: '' } as never)).toBeNull();
});

test('builds restore reconcile payloads from available App Store purchases', () => {
  expect(
    buildReconcilePayloadFromPurchases([
      { purchaseToken: 'signed-1' },
      { purchaseToken: null },
      { purchaseToken: 'signed-2' },
    ] as never),
  ).toEqual({ signedTransactions: ['signed-1', 'signed-2'] });
});

test('finishes purchases only after backend ingest succeeds', async () => {
  const successfulFinishCalls: unknown[] = [];
  const failingFinishCalls: unknown[] = [];

  await expect(
    ingestAndFinishPurchase({
      purchase: { purchaseToken: 'signed-jws' } as never,
      ingest: async () => ({ subscription: activeSubscription }),
      finish: async (purchase) => {
        successfulFinishCalls.push(purchase);
      },
    }),
  ).resolves.toEqual(activeSubscription);

  await expect(
    ingestAndFinishPurchase({
      purchase: { purchaseToken: 'signed-jws' } as never,
      ingest: async () => {
        throw new Error('backend rejected purchase');
      },
      finish: async (purchase) => {
        failingFinishCalls.push(purchase);
      },
    }),
  ).rejects.toThrow('backend rejected purchase');

  expect(successfulFinishCalls).toHaveLength(1);
  expect(failingFinishCalls).toHaveLength(0);
});

test('recognizes user-cancelled purchase errors without surfacing them as failures', () => {
  expect(isUserCancelledPurchaseError({ code: 'user-cancelled' })).toBe(true);
  expect(isUserCancelledPurchaseError(new Error('User cancel'))).toBe(true);
  expect(isUserCancelledPurchaseError({ code: 'network-error' })).toBe(false);
});
