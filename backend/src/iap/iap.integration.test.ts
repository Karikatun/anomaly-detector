import { randomUUID } from 'node:crypto'

import { Environment, Status, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { beforeEach, afterAll, describe, expect, test } from 'bun:test'

import { createApp } from '../app'
import { createPrisma } from '../db'
import type { AppEnv } from '../env'
import { AppError } from '../http/errors'
import type { AppStoreSubscriptionVerifier, AppStoreVerificationResult } from './apple-verifier'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('iap API integration', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: ['http://localhost:5173'],
    ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30,
    COOKIE_SECURE: false,
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    APPLE_IAP_ENVIRONMENT: 'Sandbox',
    APPLE_IAP_PRODUCT_IDS: ['premium_monthly', 'premium_yearly'],
  }
  const prisma = createPrisma(databaseUrl!)
  let verifier = new FakeAppStoreVerifier()
  let app = createApp({ env, prisma, iapVerifier: verifier })

  beforeEach(async () => {
    verifier = new FakeAppStoreVerifier()
    app = createApp({ env, prisma, iapVerifier: verifier })
    await prisma.appStoreWebhook.deleteMany()
    await prisma.appStoreTransaction.deleteMany()
    await prisma.subscriptionEntitlement.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('ingests a valid App Store transaction and exposes it on /me', async () => {
    const session = await registerAndAuthorize('active@example.com')
    verifier.setTransaction('signed-active', activeTransaction(session.user.id))
    verifier.setRenewal('signed-renewal-active', activeRenewal())

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-active',
      signedRenewalInfo: 'signed-renewal-active',
    })
    const ingestBody = await ingest.json()

    expect(ingest.status).toBe(200)
    expect(ingestBody.subscription).toMatchObject({
      entitlement: 'premium',
      isActive: true,
      platform: 'ios',
      productId: 'premium_monthly',
      state: 'active',
    })

    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
    const meBody = await me.json()

    expect(me.status).toBe(200)
    expect(meBody.user.subscription.isActive).toBe(true)
    expect(meBody.user.subscription.transactionId).toBe('transaction-active')
  })

  test('rejects invalid transactions without finishing ownership state', async () => {
    const session = await registerAndAuthorize('invalid@example.com')

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-missing',
    })
    const body = await ingest.json()

    expect(ingest.status).toBe(400)
    expect(body.error.code).toBe('IAP_INVALID_TRANSACTION')
    expect(await prisma.subscriptionEntitlement.count()).toBe(0)
  })

  test('rejects a purchase linked to another app account token', async () => {
    const session = await registerAndAuthorize('owner@example.com')
    verifier.setTransaction('signed-other-owner', activeTransaction(randomUUID()))

    const ingest = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-other-owner',
    })
    const body = await ingest.json()

    expect(ingest.status).toBe(403)
    expect(body.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
    expect(await prisma.appStoreTransaction.count()).toBe(0)
  })

  test('replays the same transaction idempotently', async () => {
    const session = await registerAndAuthorize('replay@example.com')
    verifier.setTransaction('signed-replay', activeTransaction(session.user.id))

    const first = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-replay',
    })
    const second = await postJson('/api/iap/app-store/transactions', session.accessToken, {
      signedTransactionInfo: 'signed-replay',
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await prisma.appStoreTransaction.count()).toBe(1)
    expect(await prisma.subscriptionEntitlement.count()).toBe(1)
  })

  test('reconciles expired App Store status to an inactive entitlement', async () => {
    const session = await registerAndAuthorize('expired@example.com')
    verifier.setTransaction('signed-expired', {
      ...activeTransaction(session.user.id),
      expiresDate: Date.now() - 24 * 60 * 60 * 1000,
      transactionId: 'transaction-expired',
    })
    verifier.setStatuses('original-active', [
      {
        status: Status.EXPIRED,
        signedTransactionInfo: 'signed-expired',
      },
    ])

    const reconcile = await postJson('/api/iap/app-store/reconcile', session.accessToken, {
      originalTransactionIds: ['original-active'],
    })
    const body = await reconcile.json()

    expect(reconcile.status).toBe(200)
    expect(body.subscription).toMatchObject({
      isActive: false,
      state: 'expired',
      transactionId: 'transaction-expired',
    })
  })

  test('records duplicate App Store webhooks once and processes the first payload', async () => {
    const session = await registerAndAuthorize('webhook@example.com')
    verifier.setTransaction('signed-webhook-active', {
      ...activeTransaction(session.user.id),
      transactionId: 'transaction-webhook',
    })
    verifier.setNotification('signed-webhook', {
      notificationUUID: 'notification-1',
      notificationType: 'DID_RENEW',
      data: {
        environment: Environment.SANDBOX,
        signedTransactionInfo: 'signed-webhook-active',
        status: Status.ACTIVE,
      },
    })

    const first = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook' }),
    })
    const firstBody = await first.json()
    const second = await app.request('/api/webhooks/app-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'signed-webhook' }),
    })
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(firstBody.duplicate).toBe(false)
    expect(second.status).toBe(200)
    expect(secondBody.duplicate).toBe(true)
    expect(await prisma.appStoreWebhook.count()).toBe(1)
    expect(await prisma.appStoreTransaction.count()).toBe(1)
  })

  async function registerAndAuthorize(email: string) {
    const response = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        email,
        password: 'password123',
      }),
    })
    expect(response.status).toBe(201)
    return response.json() as Promise<{
      accessToken: string
      user: { id: string }
    }>
  }

  function postJson(path: string, accessToken: string, body: unknown) {
    return app.request(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }
})

class FakeAppStoreVerifier implements AppStoreSubscriptionVerifier {
  private readonly transactions = new Map<string, JWSTransactionDecodedPayload>()
  private readonly renewals = new Map<string, JWSRenewalInfoDecodedPayload>()
  private readonly notifications = new Map<string, ResponseBodyV2DecodedPayload>()
  private readonly statuses = new Map<string, Awaited<ReturnType<AppStoreSubscriptionVerifier['getSubscriptionStatuses']>>>()

  setTransaction(signedTransactionInfo: string, payload: JWSTransactionDecodedPayload) {
    this.transactions.set(signedTransactionInfo, payload)
  }

  setRenewal(signedRenewalInfo: string, payload: JWSRenewalInfoDecodedPayload) {
    this.renewals.set(signedRenewalInfo, payload)
  }

  setNotification(signedPayload: string, payload: ResponseBodyV2DecodedPayload) {
    this.notifications.set(signedPayload, payload)
  }

  setStatuses(
    transactionId: string,
    statuses: Awaited<ReturnType<AppStoreSubscriptionVerifier['getSubscriptionStatuses']>>,
  ) {
    this.statuses.set(transactionId, statuses)
  }

  async verifyTransaction(
    signedTransactionInfo: string,
  ): Promise<AppStoreVerificationResult<JWSTransactionDecodedPayload>> {
    const payload = this.transactions.get(signedTransactionInfo)
    if (!payload) {
      throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Fake transaction not found')
    }
    return { environment: Environment.SANDBOX, payload }
  }

  async verifyRenewalInfo(
    signedRenewalInfo: string,
  ): Promise<AppStoreVerificationResult<JWSRenewalInfoDecodedPayload>> {
    const payload = this.renewals.get(signedRenewalInfo)
    if (!payload) {
      throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Fake renewal not found')
    }
    return { environment: Environment.SANDBOX, payload }
  }

  async verifyNotification(
    signedPayload: string,
  ): Promise<AppStoreVerificationResult<ResponseBodyV2DecodedPayload>> {
    const payload = this.notifications.get(signedPayload)
    if (!payload) {
      throw new AppError(400, 'IAP_INVALID_TRANSACTION', 'Fake notification not found')
    }
    return { environment: Environment.SANDBOX, payload }
  }

  async getSubscriptionStatuses({ transactionId }: { transactionId: string }) {
    return this.statuses.get(transactionId) ?? []
  }
}

function activeTransaction(appAccountToken: string): JWSTransactionDecodedPayload {
  return {
    appAccountToken,
    environment: Environment.SANDBOX,
    expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    originalTransactionId: 'original-active',
    productId: 'premium_monthly',
    purchaseDate: Date.now() - 60_000,
    transactionId: 'transaction-active',
    webOrderLineItemId: 'web-order-active',
  }
}

function activeRenewal(): JWSRenewalInfoDecodedPayload {
  return {
    autoRenewProductId: 'premium_monthly',
    autoRenewStatus: 1,
    environment: Environment.SANDBOX,
    originalTransactionId: 'original-active',
    productId: 'premium_monthly',
    renewalDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
  }
}
