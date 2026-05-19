import { createHash } from 'node:crypto'

import { AutoRenewStatus, Environment, Status, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library'
import type { SubscriptionSnapshot } from '@web-app-demo/contracts'

import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { SubscriptionState } from '../generated/prisma/enums'
import { AppError } from '../http/errors'
import type {
  AppStoreStatusTransaction,
  AppStoreSubscriptionVerifier,
  AppStoreVerificationResult,
} from './apple-verifier'

export type EntitlementRecord = {
  platform: 'ios' | null
  state: SubscriptionState
  productId: string | null
  originalTransactionId: string | null
  transactionId: string | null
  expiresAt: Date | null
  willAutoRenew: boolean | null
  updatedAt: Date
}

type ApplyTransactionInput = {
  userId: string
  signedTransactionInfo: string
  signedRenewalInfo?: string | null
  verifiedTransaction: AppStoreVerificationResult<JWSTransactionDecodedPayload>
  verifiedRenewal?: AppStoreVerificationResult<JWSRenewalInfoDecodedPayload> | null
  status?: Status | number | null
}

export function inactiveSubscriptionSnapshot(): SubscriptionSnapshot {
  return {
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
  }
}

export async function getSubscriptionSnapshot(db: DbClient, userId: string): Promise<SubscriptionSnapshot> {
  const entitlement = await db.subscriptionEntitlement.findUnique({
    where: { userId },
  })

  return entitlement ? toSubscriptionSnapshot(entitlement) : inactiveSubscriptionSnapshot()
}

export async function ingestAppStoreTransaction(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  userId: string
  signedTransactionInfo: string
  signedRenewalInfo?: string | null
}): Promise<SubscriptionSnapshot> {
  const verifiedTransaction = await input.verifier.verifyTransaction(input.signedTransactionInfo)
  const verifiedRenewal = input.signedRenewalInfo
    ? await input.verifier.verifyRenewalInfo(input.signedRenewalInfo)
    : null

  return applyVerifiedAppStoreTransaction({
    db: input.db,
    env: input.env,
    input: {
      userId: input.userId,
      signedTransactionInfo: input.signedTransactionInfo,
      signedRenewalInfo: input.signedRenewalInfo,
      verifiedTransaction,
      verifiedRenewal,
    },
  })
}

export async function reconcileAppStoreTransactions(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  userId: string
  signedTransactions?: string[]
  originalTransactionIds?: string[]
}): Promise<SubscriptionSnapshot> {
  let latestSnapshot: SubscriptionSnapshot | null = null

  for (const signedTransactionInfo of input.signedTransactions ?? []) {
    latestSnapshot = await ingestAppStoreTransaction({
      db: input.db,
      env: input.env,
      verifier: input.verifier,
      userId: input.userId,
      signedTransactionInfo,
    })
  }

  for (const originalTransactionId of input.originalTransactionIds ?? []) {
    const statusItems = await input.verifier.getSubscriptionStatuses({
      transactionId: originalTransactionId,
    })
    latestSnapshot =
      (await applyStatusTransactions({
        db: input.db,
        env: input.env,
        verifier: input.verifier,
        userId: input.userId,
        statusItems,
      })) ?? latestSnapshot
  }

  return latestSnapshot ?? getSubscriptionSnapshot(input.db, input.userId)
}

export async function recordAndProcessAppStoreWebhook(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  signedPayload: string
}): Promise<{ duplicate: boolean; subscription: SubscriptionSnapshot | null }> {
  const signedPayloadHash = hashToken(input.signedPayload)
  const existing = await input.db.appStoreWebhook.findUnique({
    where: { signedPayloadHash },
  })

  if (existing?.processedAt) {
    return { duplicate: true, subscription: null }
  }

  const verifiedNotification = await input.verifier.verifyNotification(input.signedPayload)
  const notification = verifiedNotification.payload
  const signedTransactionInfo = notification.data?.signedTransactionInfo
  const signedRenewalInfo = notification.data?.signedRenewalInfo
  const verifiedTransaction = signedTransactionInfo
    ? await input.verifier.verifyTransaction(signedTransactionInfo)
    : null
  const verifiedRenewal = signedRenewalInfo ? await input.verifier.verifyRenewalInfo(signedRenewalInfo) : null
  const transaction = verifiedTransaction?.payload

  const webhook = await input.db.appStoreWebhook.upsert({
    where: { signedPayloadHash },
    create: {
      signedPayloadHash,
      notificationUuid: notification.notificationUUID ?? null,
      notificationType: notification.notificationType ? String(notification.notificationType) : null,
      subtype: notification.subtype ? String(notification.subtype) : null,
      environment: formatEnvironment(notification.data?.environment ?? verifiedNotification.environment),
      originalTransactionId: transaction?.originalTransactionId ?? null,
      transactionId: transaction?.transactionId ?? null,
    },
    update: {
      notificationUuid: notification.notificationUUID ?? existing?.notificationUuid ?? null,
      notificationType: notification.notificationType ? String(notification.notificationType) : existing?.notificationType,
      subtype: notification.subtype ? String(notification.subtype) : existing?.subtype,
      environment: formatEnvironment(notification.data?.environment ?? verifiedNotification.environment),
      originalTransactionId: transaction?.originalTransactionId ?? existing?.originalTransactionId,
      transactionId: transaction?.transactionId ?? existing?.transactionId,
    },
  })

  if (!signedTransactionInfo || !verifiedTransaction) {
    await input.db.appStoreWebhook.update({
      where: { id: webhook.id },
      data: { processedAt: new Date() },
    })
    return { duplicate: Boolean(existing), subscription: null }
  }

  const userId = await resolveWebhookUserId({
    db: input.db,
    transaction: verifiedTransaction.payload,
  })

  if (!userId) {
    await input.db.appStoreWebhook.update({
      where: { id: webhook.id },
      data: { processedAt: new Date() },
    })
    return { duplicate: Boolean(existing), subscription: null }
  }

  const subscription = await applyVerifiedAppStoreTransaction({
    db: input.db,
    env: input.env,
    input: {
      userId,
      signedTransactionInfo,
      signedRenewalInfo,
      verifiedTransaction,
      verifiedRenewal,
      status: notification.data?.status,
    },
  })

  await input.db.appStoreWebhook.update({
    where: { id: webhook.id },
    data: { processedAt: new Date() },
  })

  return { duplicate: Boolean(existing), subscription }
}

async function applyStatusTransactions(input: {
  db: DbClient
  env: AppEnv
  verifier: AppStoreSubscriptionVerifier
  userId: string
  statusItems: AppStoreStatusTransaction[]
}): Promise<SubscriptionSnapshot | null> {
  let latestSnapshot: SubscriptionSnapshot | null = null

  for (const item of input.statusItems) {
    if (!item.signedTransactionInfo) continue

    const verifiedTransaction = await input.verifier.verifyTransaction(item.signedTransactionInfo)
    const verifiedRenewal = item.signedRenewalInfo
      ? await input.verifier.verifyRenewalInfo(item.signedRenewalInfo)
      : null

    latestSnapshot = await applyVerifiedAppStoreTransaction({
      db: input.db,
      env: input.env,
      input: {
        userId: input.userId,
        signedTransactionInfo: item.signedTransactionInfo,
        signedRenewalInfo: item.signedRenewalInfo,
        verifiedTransaction,
        verifiedRenewal,
        status: item.status,
      },
    })
  }

  return latestSnapshot
}

async function applyVerifiedAppStoreTransaction({
  db,
  env,
  input,
}: {
  db: DbClient
  env: AppEnv
  input: ApplyTransactionInput
}): Promise<SubscriptionSnapshot> {
  const transaction = input.verifiedTransaction.payload
  const renewal = input.verifiedRenewal?.payload ?? null
  const originalTransactionId = transaction.originalTransactionId ?? renewal?.originalTransactionId
  const transactionId = transaction.transactionId
  const productId = transaction.productId ?? renewal?.productId ?? renewal?.autoRenewProductId

  if (!originalTransactionId || !transactionId || !productId) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'App Store transaction is missing required identifiers')
  }

  if (env.APPLE_IAP_PRODUCT_IDS.length > 0 && !env.APPLE_IAP_PRODUCT_IDS.includes(productId)) {
    throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'App Store transaction product is not configured')
  }

  if (!transaction.appAccountToken || transaction.appAccountToken !== input.userId) {
    throw new AppError(
      403,
      'IAP_OWNERSHIP_MISMATCH',
      'This App Store purchase is linked to another account',
    )
  }

  const state = resolveSubscriptionState(transaction, renewal, input.status)
  const expiresAt = toDate(transaction.expiresDate ?? renewal?.renewalDate)
  const willAutoRenew =
    renewal?.autoRenewStatus == null ? null : renewal.autoRenewStatus === AutoRenewStatus.ON
  const environment = formatEnvironment(transaction.environment ?? renewal?.environment ?? input.verifiedTransaction.environment)
  const signedTransactionHash = hashToken(input.signedTransactionInfo)
  const signedRenewalHash = input.signedRenewalInfo ? hashToken(input.signedRenewalInfo) : null

  const entitlement = await db.$transaction(async (tx) => {
    await tx.appStoreTransaction.upsert({
      where: { transactionId },
      create: {
        userId: input.userId,
        originalTransactionId,
        transactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        productId,
        state,
        environment,
        appAccountToken: transaction.appAccountToken ?? null,
        purchaseDate: toDate(transaction.purchaseDate),
        expiresAt,
        revokedAt: toDate(transaction.revocationDate),
        willAutoRenew,
        signedTransactionHash,
        signedRenewalHash,
      },
      update: {
        userId: input.userId,
        originalTransactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        productId,
        state,
        environment,
        appAccountToken: transaction.appAccountToken ?? null,
        purchaseDate: toDate(transaction.purchaseDate),
        expiresAt,
        revokedAt: toDate(transaction.revocationDate),
        willAutoRenew,
        signedTransactionHash,
        signedRenewalHash,
      },
    })

    return tx.subscriptionEntitlement.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        entitlementKey: 'premium',
        platform: 'ios',
        state,
        productId,
        originalTransactionId,
        transactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        expiresAt,
        willAutoRenew,
        environment,
      },
      update: {
        platform: 'ios',
        state,
        productId,
        originalTransactionId,
        transactionId,
        webOrderLineItemId: transaction.webOrderLineItemId ?? null,
        expiresAt,
        willAutoRenew,
        environment,
      },
    })
  })

  return toSubscriptionSnapshot(entitlement)
}

async function resolveWebhookUserId({
  db,
  transaction,
}: {
  db: DbClient
  transaction: JWSTransactionDecodedPayload
}) {
  if (transaction.appAccountToken) {
    const user = await db.user.findUnique({
      where: { id: transaction.appAccountToken },
      select: { id: true },
    })
    if (user) return user.id
  }

  if (transaction.originalTransactionId) {
    const entitlement = await db.subscriptionEntitlement.findUnique({
      where: { originalTransactionId: transaction.originalTransactionId },
      select: { userId: true },
    })
    if (entitlement) return entitlement.userId
  }

  return null
}

function resolveSubscriptionState(
  transaction: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  status?: Status | number | null,
): SubscriptionState {
  if (transaction.revocationDate) return SubscriptionState.revoked

  switch (status) {
    case Status.ACTIVE:
      return SubscriptionState.active
    case Status.BILLING_GRACE_PERIOD:
      return SubscriptionState.billing_grace_period
    case Status.BILLING_RETRY:
      return SubscriptionState.billing_retry
    case Status.EXPIRED:
      return SubscriptionState.expired
    case Status.REVOKED:
      return SubscriptionState.revoked
  }

  if (renewal?.isInBillingRetryPeriod) return SubscriptionState.billing_retry

  const expiresAt = toDate(transaction.expiresDate ?? renewal?.renewalDate)
  if (!expiresAt || expiresAt.getTime() > Date.now()) return SubscriptionState.active

  return SubscriptionState.expired
}

export function toSubscriptionSnapshot(entitlement: EntitlementRecord): SubscriptionSnapshot {
  const isActive =
    entitlement.state === SubscriptionState.active ||
    entitlement.state === SubscriptionState.billing_grace_period

  return {
    entitlement: 'premium',
    isActive,
    state: entitlement.state,
    platform: entitlement.platform,
    productId: entitlement.productId,
    originalTransactionId: entitlement.originalTransactionId,
    transactionId: entitlement.transactionId,
    expiresAt: entitlement.expiresAt?.toISOString() ?? null,
    willAutoRenew: entitlement.willAutoRenew,
    updatedAt: entitlement.updatedAt.toISOString(),
  }
}

function toDate(value: number | null | undefined) {
  if (!value) return null
  return new Date(value)
}

function formatEnvironment(value: Environment | string | null | undefined) {
  if (!value) return null
  return String(value).toLowerCase()
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
