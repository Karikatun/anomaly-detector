import { describe, expect, test } from 'bun:test'

import {
  appStoreReconcileRequestSchema,
  appStoreTransactionRequestSchema,
  appStoreWebhookRequestSchema,
  iapEntitlementResponseSchema,
  subscriptionSnapshotSchema,
} from './iap'

const inactiveSubscription = {
  entitlement: 'premium',
  isActive: false,
  state: 'inactive',
  platform: null,
  productId: null,
  originalTransactionId: null,
  transactionId: null,
  expiresAt: null,
  willAutoRenew: null,
  updatedAt: null,
} as const

describe('iap contracts', () => {
  test('parses inactive and active subscription snapshots', () => {
    expect(subscriptionSnapshotSchema.parse(inactiveSubscription)).toEqual(inactiveSubscription)

    expect(
      subscriptionSnapshotSchema.parse({
        entitlement: 'premium',
        isActive: true,
        state: 'active',
        platform: 'ios',
        productId: 'com.example.premium.monthly',
        originalTransactionId: '1000000000000001',
        transactionId: '1000000000000002',
        expiresAt: '2026-06-01T00:00:00.000Z',
        willAutoRenew: true,
        updatedAt: '2026-05-19T00:00:00.000Z',
      }),
    ).toMatchObject({
      isActive: true,
      state: 'active',
      platform: 'ios',
    })
  })

  test('validates App Store transaction and reconcile payloads', () => {
    expect(
      appStoreTransactionRequestSchema.parse({
        signedTransactionInfo: 'signed-jws',
      }),
    ).toEqual({ signedTransactionInfo: 'signed-jws' })

    expect(
      appStoreReconcileRequestSchema.parse({
        signedTransactions: ['signed-jws'],
        originalTransactionIds: ['original-transaction-id'],
      }),
    ).toEqual({
      signedTransactions: ['signed-jws'],
      originalTransactionIds: ['original-transaction-id'],
    })

    expect(() => appStoreReconcileRequestSchema.parse({})).toThrow()
  })

  test('validates entitlement and webhook payloads', () => {
    expect(iapEntitlementResponseSchema.parse({ subscription: inactiveSubscription })).toEqual({
      subscription: inactiveSubscription,
    })

    expect(appStoreWebhookRequestSchema.parse({ signedPayload: 'payload' })).toEqual({
      signedPayload: 'payload',
    })
  })
})
