import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

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
