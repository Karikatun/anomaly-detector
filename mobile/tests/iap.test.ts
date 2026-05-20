import { expect, test } from 'bun:test';

const {
  buildReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  extractSignedTransactionInfo,
  friendlyIapErrorMessage,
  ingestAndFinishPurchase,
  introOfferLabel,
  isRetryableIapError,
  isUserCancelledPurchaseError,
  purchaseButtonLabel,
  retryIapOperation,
  validateAppStorePurchaseForIngest,
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
  expect(buildSubscriptionPurchaseRequest('premium_monthly', '018fd4f2-1f3a-7c88-bc49-333333333333')).toEqual({
    type: 'subs',
    request: {
      apple: {
        sku: 'premium_monthly',
        appAccountToken: '018fd4f2-1f3a-7c88-bc49-333333333333',
        andDangerouslyFinishTransactionAutomatically: false,
      },
    },
  });

  expect(() => buildSubscriptionPurchaseRequest('premium_monthly', 'user-uuid')).toThrow('UUID');
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
      { purchaseToken: 'signed-1' },
    ] as never, ['original-1', 'original-1']),
  ).toEqual({ signedTransactions: ['signed-1', 'signed-2'], originalTransactionIds: ['original-1'] });
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
  ).resolves.toEqual({ finishError: null, subscription: activeSubscription });

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

test('retries transient finish failures after backend ingest succeeds', async () => {
  const finishCalls: unknown[] = [];

  await expect(
    ingestAndFinishPurchase({
      purchase: { purchaseToken: 'signed-jws' } as never,
      ingest: async () => ({ subscription: activeSubscription }),
      finish: async (purchase) => {
        finishCalls.push(purchase);
        if (finishCalls.length === 1) {
          throw { code: 'service-error' };
        }
      },
    }),
  ).resolves.toEqual({ finishError: null, subscription: activeSubscription });

  expect(finishCalls).toHaveLength(2);
});

test('returns verified subscriptions even when post-ingest finish fails', async () => {
  const finishError = new Error('finish failed');
  const result = await ingestAndFinishPurchase({
    purchase: { purchaseToken: 'signed-jws' } as never,
    ingest: async () => ({ subscription: activeSubscription }),
    finish: async () => {
      throw finishError;
    },
  });

  expect(result).toEqual({
    finishError,
    subscription: activeSubscription,
  });
});

test('recognizes user-cancelled purchase errors without surfacing them as failures', () => {
  expect(isUserCancelledPurchaseError({ code: 'user-cancelled' })).toBe(true);
  expect(isUserCancelledPurchaseError({ code: 'E_USER_CANCELLED' })).toBe(true);
  expect(isUserCancelledPurchaseError(new Error('User cancel'))).toBe(true);
  expect(isUserCancelledPurchaseError(new Error('Purchase cancelled by user'))).toBe(true);
  expect(isUserCancelledPurchaseError({ code: 'network-error' })).toBe(false);
  expect(isUserCancelledPurchaseError(new Error('Cannot complete purchase'))).toBe(false);
});

test('classifies retryable IAP errors and returns friendly messages', async () => {
  expect(isRetryableIapError({ code: 'network-error' })).toBe(true);
  expect(isRetryableIapError({ code: 'E_SERVICE_ERROR' })).toBe(true);
  expect(isRetryableIapError({ code: 'SERVICE_ERROR' })).toBe(true);
  expect(isRetryableIapError({ code: 'billing-unavailable' })).toBe(true);
  expect(isRetryableIapError({ code: 'init-connection' })).toBe(true);
  expect(isRetryableIapError({ code: 'query-product' })).toBe(true);
  expect(isRetryableIapError({ code: 'item-unavailable' })).toBe(false);
  expect(friendlyIapErrorMessage({ code: 'item-unavailable' })).toContain('not available');
  expect(friendlyIapErrorMessage({ code: 'query-product' })).toContain('temporarily unavailable');
  expect(friendlyIapErrorMessage({ code: 'init-connection' })).toContain('temporarily unavailable');
  expect(friendlyIapErrorMessage({ code: 'user-error' })).toContain('payment settings');
  expect(friendlyIapErrorMessage({ code: 'E_USER_ERROR' })).toContain('payment settings');
  expect(friendlyIapErrorMessage({ code: 'UserError' })).toContain('payment settings');

  let attempts = 0;
  const delays: number[] = [];
  await expect(
    retryIapOperation(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw { code: 'service-error' };
        }
        return 'ok';
      },
      {
        attempts: 3,
        baseDelayMs: 10,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    ),
  ).resolves.toBe('ok');
  expect(attempts).toBe(3);
  expect(delays).toEqual([10, 20]);
});

test('validates App Store purchases before backend ingest', () => {
  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
      store: 'apple',
      transactionId: 'transaction-1',
    } as never),
  ).toEqual({
    ok: true,
    signedTransactionInfo: 'signed-jws',
    transactionKey: 'transaction-1',
  });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'pending',
      store: 'apple',
    } as never),
  ).toMatchObject({ ok: false, pending: true });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseState: 'purchased',
      store: 'apple',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
      store: 'google',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
      store: 'unknown',
    } as never),
  ).toMatchObject({ ok: false, pending: false });

  expect(
    validateAppStorePurchaseForIngest({
      purchaseToken: 'signed-jws',
      purchaseState: 'purchased',
    } as never),
  ).toMatchObject({ ok: false, pending: false });
});

test('formats iOS introductory offer copy by payment mode', () => {
  const baseProduct = {
    displayPrice: '$9.99',
    subscriptionOffers: [
      {
        displayPrice: '$0.00',
        paymentMode: 'free-trial',
        period: { unit: 'week' },
        periodCount: 2,
        type: 'introductory',
      },
    ],
  } as never;

  expect(introOfferLabel(baseProduct)).toBe('Free trial for 2 weeks');
  expect(purchaseButtonLabel(baseProduct)).toBe('Free trial for 2 weeks, then $9.99');
  expect(
    introOfferLabel({
      ...baseProduct,
      subscriptionOffers: [
        {
          displayPrice: '$0.99',
          paymentMode: 'pay-as-you-go',
          period: { unit: 'month' },
          periodCount: 3,
          type: 'introductory',
        },
      ],
    } as never),
  ).toBe('Intro pay-as-you-go price: $0.99 for 3 months');
  expect(
    introOfferLabel({
      ...baseProduct,
      subscriptionOffers: [
        {
          displayPrice: '$19.99',
          paymentMode: 'pay-up-front',
          period: { unit: 'year' },
          periodCount: 1,
          type: 'introductory',
        },
      ],
    } as never),
  ).toBe('Intro upfront price: $19.99 for first 1 year');

  expect(
    introOfferLabel({
      ...baseProduct,
      subscriptionOffers: [
        {
          displayPrice: '$4.99',
          paymentMode: 'pay-up-front',
          period: { unit: 'month' },
          periodCount: 1,
          type: 'promotional',
        },
      ],
      subscriptionInfoIOS: {
        introductoryOffer: {
          displayPrice: '$0.00',
          paymentMode: 'free-trial',
          period: { unit: 'week' },
          periodCount: 1,
        },
      },
    } as never),
  ).toBe('Free trial for 1 week');
});
