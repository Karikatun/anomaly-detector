import { Environment, OfferType, Type, type JWSRenewalInfoDecodedPayload, type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library'
import { OpenAPIHono } from '@hono/zod-openapi'
import { SignJWT } from 'jose'
import { expect, mock, test } from 'bun:test'

import type { AppBindings } from '../app'
import type { DbClient } from '../db'
import type { AppEnv } from '../env'
import { SubscriptionState } from '../generated/prisma/enums'
import { handleError } from '../http/errors'
import { createIapRoutes } from './routes'
import type { AppStoreSubscriptionVerifier } from './apple-verifier'

const userId = '018fd4f2-1f3a-7c88-bc49-333333333333'
const otherUserId = '018fd4f2-1f3a-7c88-bc49-444444444444'
const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
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
  APPLE_IAP_PRODUCT_IDS: ['premium_monthly'],
}

test('offer-code redemption route links tokenless App Store transactions only for the issuing user', async () => {
  const entitlementUpsert = mock(async () => entitlementRecord())
  const transactionUpsert = mock(async () => ({ id: 'transaction-row-1' }))
  const app = createTestIapApp(createFakeDb({ entitlementUpsert, transactionUpsert }))

  const tokenResponse = await postJson(app, '/api/iap/app-store/offer-code-redemption', userId)
  const tokenBody = await tokenResponse.json()
  expect(tokenResponse.status).toBe(200)
  expect(tokenBody.token).toBeString()

  const accepted = await postJson(app, '/api/iap/app-store/transactions', userId, {
    offerCodeRedemptionToken: tokenBody.token,
    signedTransactionInfo: 'signed-offer-code',
  })
  const acceptedBody = await accepted.json()

  expect(accepted.status).toBe(200)
  expect(acceptedBody.subscription).toMatchObject({
    isActive: true,
    transactionId: 'transaction-offer-code',
  })
  expect(transactionUpsert).toHaveBeenCalledTimes(1)
  expect(entitlementUpsert).toHaveBeenCalledTimes(1)

  const wrongUser = await postJson(app, '/api/iap/app-store/transactions', otherUserId, {
    offerCodeRedemptionToken: tokenBody.token,
    signedTransactionInfo: 'signed-offer-code',
  })
  const wrongUserBody = await wrongUser.json()

  expect(wrongUser.status).toBe(403)
  expect(wrongUserBody.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
  expect(entitlementUpsert).toHaveBeenCalledTimes(1)
})

test('offer-code redemption route rejects expired redemption tokens before entitlement writes', async () => {
  const entitlementUpsert = mock(async () => entitlementRecord())
  const transactionUpsert = mock(async () => ({ id: 'transaction-row-1' }))
  const app = createTestIapApp(createFakeDb({ entitlementUpsert, transactionUpsert }))
  const expiredToken = await new SignJWT({ scope: 'iap_offer_code_redemption' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 60 * 60)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
    .sign(new TextEncoder().encode(env.JWT_SECRET))

  const response = await postJson(app, '/api/iap/app-store/transactions', userId, {
    offerCodeRedemptionToken: expiredToken,
    signedTransactionInfo: 'signed-offer-code',
  })
  const body = await response.json()

  expect(response.status).toBe(403)
  expect(body.error.code).toBe('IAP_OWNERSHIP_MISMATCH')
  expect(transactionUpsert).not.toHaveBeenCalled()
  expect(entitlementUpsert).not.toHaveBeenCalled()
})

function createTestIapApp(db: DbClient) {
  const app = new OpenAPIHono<AppBindings>()
  app.use('*', async (c, next) => {
    c.set('authService', {
      getMe: async (accessToken: string | undefined) => ({
        user: { id: accessToken },
      }),
    } as never)
    c.set('env', env)
    c.set('iapVerifier', fakeOfferCodeVerifier())
    c.set('prisma', db)
    c.set('storageService', null)
    await next()
  })
  app.route('/api/iap', createIapRoutes())
  app.onError(handleError)
  return app
}

function createFakeDb({
  entitlementUpsert,
  transactionUpsert,
}: {
  entitlementUpsert: ReturnType<typeof mock>
  transactionUpsert: ReturnType<typeof mock>
}) {
  const db = {
    appStoreTransaction: {
      upsert: transactionUpsert,
    },
    subscriptionEntitlement: {
      findUnique: mock(async () => null),
      upsert: entitlementUpsert,
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  }
  return db as unknown as DbClient
}

function fakeOfferCodeVerifier(): AppStoreSubscriptionVerifier {
  return {
    async verifyTransaction(): Promise<{ environment: Environment; payload: JWSTransactionDecodedPayload }> {
      return {
        environment: Environment.SANDBOX,
        payload: {
          environment: Environment.SANDBOX,
          expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
          offerIdentifier: 'WINBACK2026',
          offerType: OfferType.OFFER_CODE,
          originalTransactionId: 'original-offer-code',
          productId: 'premium_monthly',
          purchaseDate: Date.now(),
          transactionId: 'transaction-offer-code',
          type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
        },
      }
    },
    async verifyRenewalInfo(): Promise<{ environment: Environment; payload: JWSRenewalInfoDecodedPayload }> {
      throw new Error('unexpected renewal verification')
    },
    async verifyNotification(): Promise<{ environment: Environment; payload: ResponseBodyV2DecodedPayload }> {
      throw new Error('unexpected notification verification')
    },
    async getSubscriptionStatuses() {
      return []
    },
  }
}

function entitlementRecord() {
  return {
    platform: 'ios',
    state: SubscriptionState.active,
    productId: 'premium_monthly',
    originalTransactionId: 'original-offer-code',
    transactionId: 'transaction-offer-code',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    willAutoRenew: null,
    updatedAt: new Date(),
  }
}

function postJson(app: ReturnType<typeof createTestIapApp>, path: string, userId: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userId}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
