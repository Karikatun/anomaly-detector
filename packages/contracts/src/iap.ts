import { z } from 'zod'

export const subscriptionStateSchema = z.enum([
  'inactive',
  'pending',
  'active',
  'billing_grace_period',
  'billing_retry',
  'expired',
  'revoked',
])

export const subscriptionPlatformSchema = z.enum(['ios']).nullable()

export const subscriptionSnapshotSchema = z.object({
  entitlement: z.literal('premium'),
  isActive: z.boolean(),
  state: subscriptionStateSchema,
  platform: subscriptionPlatformSchema,
  productId: z.string().nullable(),
  originalTransactionId: z.string().nullable(),
  transactionId: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  willAutoRenew: z.boolean().nullable(),
  updatedAt: z.string().datetime().nullable(),
})

export const appStoreTransactionRequestSchema = z.object({
  signedTransactionInfo: z.string().trim().min(1),
  signedRenewalInfo: z.string().trim().min(1).optional(),
})

export const appStoreReconcileRequestSchema = z
  .object({
    signedTransactions: z.array(z.string().trim().min(1)).max(20).optional(),
    originalTransactionIds: z.array(z.string().trim().min(1)).max(20).optional(),
  })
  .refine(
    (value) =>
      (value.signedTransactions?.length ?? 0) > 0 ||
      (value.originalTransactionIds?.length ?? 0) > 0,
    {
      message: 'At least one transaction or original transaction id is required',
      path: ['signedTransactions'],
    },
  )

export const appStoreWebhookRequestSchema = z.object({
  signedPayload: z.string().trim().min(1),
})

export const iapEntitlementResponseSchema = z.object({
  subscription: subscriptionSnapshotSchema,
})

export const iapMutationResponseSchema = iapEntitlementResponseSchema

export type SubscriptionState = z.infer<typeof subscriptionStateSchema>
export type SubscriptionSnapshot = z.infer<typeof subscriptionSnapshotSchema>
export type AppStoreTransactionRequest = z.infer<typeof appStoreTransactionRequestSchema>
export type AppStoreReconcileRequest = z.infer<typeof appStoreReconcileRequestSchema>
export type AppStoreWebhookRequest = z.infer<typeof appStoreWebhookRequestSchema>
export type IapEntitlementResponse = z.infer<typeof iapEntitlementResponseSchema>
export type IapMutationResponse = z.infer<typeof iapMutationResponseSchema>
