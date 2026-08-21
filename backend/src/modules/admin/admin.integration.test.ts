import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mailPolicyViewSchema } from '@anomaly-detector/contracts'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('concealed operations API integration', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const baseEnv: AppEnv = {
    ACCESS_TOKEN_TTL_SECONDS: 60,
    ADMIN_USER_IDS: [],
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    COOKIE_SECURE: false,
    CORS_ORIGINS: ['http://localhost:5173'],
    WEBAPP_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    PORT: 3000,
    REFRESH_REUSE_GRACE_SECONDS: 10,
    REFRESH_TOKEN_TTL_DAYS: 30,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    SHUTDOWN_GRACE_SECONDS: 20,
    YANDEX_STORAGE_DOWNLOAD_URL_TTL_SECONDS: 300,
    YANDEX_STORAGE_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    YANDEX_STORAGE_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    YANDEX_STORAGE_UPLOAD_URL_TTL_SECONDS: 900,
    TRUST_PROXY: false,
  }

  beforeEach(async () => {
    await prisma.mailPolicyAuditEvent.deleteMany()
    await prisma.mailPolicyCommand.deleteMany()
    await prisma.mailPolicyEntry.deleteMany()
    await prisma.mailPolicyVersion.deleteMany()
    await prisma.mailRegistryCandidate.deleteMany()
    await prisma.mailRegistryImport.deleteMany()
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('returns indistinguishable 404 responses except to the allowlisted user', async () => {
    const bootstrapApp = createApp({ env: baseEnv, prisma })
    const administrator = await register(bootstrapApp, 'operations-admin')
    const player = await register(bootstrapApp, 'operations-player')
    const app = createApp({
      env: { ...baseEnv, ADMIN_USER_IDS: [administrator.user.id] },
      prisma,
    })

    for (const authorization of [undefined, `Bearer ${player.accessToken}`]) {
      const response = await app.request('/api/operations/overview', {
        headers: authorization ? { Authorization: authorization } : undefined,
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Route not found' },
      })
    }

    const response = await app.request('/api/operations/overview', {
      headers: { Authorization: `Bearer ${administrator.accessToken}` },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(body).toMatchObject({
      totals: { users: 2, activeSessions: 2, rooms: 0, tenders: 0 },
      roomsByStatus: { waiting: 0, active: 0, completed: 0 },
      users: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
    })
    expect(JSON.stringify(body)).not.toContain('passwordHash')
    expect(JSON.stringify(body)).not.toContain('ipAddress')

    const secondPageResponse = await app.request('/api/operations/overview?page=2&pageSize=1', {
      headers: { Authorization: `Bearer ${administrator.accessToken}` },
    })
    const secondPage = await secondPageResponse.json()
    expect(secondPageResponse.status).toBe(200)
    expect(secondPage).toMatchObject({
      users: { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 },
    })
    expect(secondPage.users.items).toHaveLength(1)

    const openApi = await (await app.request('/openapi.json')).json()
    expect(JSON.stringify(openApi)).not.toContain('/api/operations')
  })

  test('allows only a recently authenticated operator to import and publish a reviewed policy', async () => {
    const bootstrapApp = createApp({ env: baseEnv, prisma })
    const administrator = await register(bootstrapApp, 'mail-policy-admin')
    const player = await register(bootstrapApp, 'mail-policy-player')
    let sourceCalls = 0
    const app = createApp({
      env: { ...baseEnv, ADMIN_USER_IDS: [administrator.user.id] },
      mailPolicySource: {
        load: async () => {
          sourceCalls += 1
          return {
            candidates: [{
              evidence: 'service_description_mentions_mail',
              registryEntryId: '1-PP',
              serviceDomain: 'mail.yandex.ru',
            }],
            checksum: 'a'.repeat(64),
            sourceDate: '2026-08-20',
            sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
          }
        },
      },
      prisma,
    })
    const importBody = JSON.stringify({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2740',
      expectedVersion: 0,
    })
    for (const authorization of [undefined, `Bearer ${player.accessToken}`]) {
      const denied = await app.request('/api/operations/mail-policy/import', {
        body: importBody,
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      expect(denied.status).toBe(404)
    }
    expect(sourceCalls).toBe(0)

    const importedResponse = await app.request('/api/operations/mail-policy/import', {
      body: importBody,
      headers: {
        Authorization: `Bearer ${administrator.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(importedResponse.status).toBe(200)
    expect(importedResponse.headers.get('cache-control')).toBe('no-store')
    const imported = mailPolicyViewSchema.parse(await importedResponse.json())
    expect(sourceCalls).toBe(1)

    const publishedResponse = await app.request('/api/operations/mail-policy/publish', {
      body: JSON.stringify({
        additions: [{
          canonicalization: {
            ignoreDots: false,
            localPartCaseInsensitive: true,
            stripPlusTag: false,
          },
          emailDomain: 'yandex.ru',
          sourceCandidateId: imported.lastSuccessfulImport!.candidates[0].id,
        }],
        commandId: '019f8099-7e26-7760-ad08-66d1d66b2741',
        expectedVersion: 0,
      }),
      headers: {
        Authorization: `Bearer ${administrator.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(publishedResponse.status).toBe(200)
    expect(mailPolicyViewSchema.parse(await publishedResponse.json())).toMatchObject({
      currentVersion: 1,
      publishedPolicy: { entries: [{ emailDomain: 'yandex.ru', state: 'approved' }] },
    })

    await prisma.authSession.updateMany({
      where: { userId: administrator.user.id },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1_000) },
    })
    const staleResponse = await app.request('/api/operations/mail-policy/status', {
      body: JSON.stringify({
        commandId: '019f8099-7e26-7760-ad08-66d1d66b2742',
        emailDomain: 'yandex.ru',
        expectedVersion: 1,
        reason: 'Security-инцидент',
        state: 'blocked',
      }),
      headers: {
        Authorization: `Bearer ${administrator.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(staleResponse.status).toBe(403)
    expect(await staleResponse.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Recent authentication is required for mail policy commands',
      },
    })
    expect(await prisma.mailPolicyVersion.count()).toBe(1)
  })
})

async function register(app: ReturnType<typeof createApp>, login: string) {
  const response = await app.request('/api/auth/token/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login,
      password: 'password123',
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsAccepted: true,
      termsVersion: '1.0',
    }),
  })

  expect(response.status).toBe(201)
  return response.json() as Promise<{
    accessToken: string
    user: { id: string }
  }>
}
