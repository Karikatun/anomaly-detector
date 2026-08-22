import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import {
  feedbackQueueResponseSchema,
  feedbackReceiptSchema,
} from '@anomaly-detector/contracts'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('feedback API integration', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const baseEnv: AppEnv = {
    ACCESS_TOKEN_TTL_SECONDS: 60,
    ADMIN_USER_IDS: [],
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    COOKIE_SECURE: false,
    MAIL_SMTP_ENABLED: false,
    MAIL_SMTP_TIMEOUT_MS: 10_000,
    MAIL_SMTP_MAX_ATTEMPTS: 5,
    MAIL_SMTP_RETRY_BASE_SECONDS: 30,
    MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD: 5,
    MAIL_SMTP_CIRCUIT_OPEN_SECONDS: 300,
    MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE: 60,
    MAIL_SMTP_LEASE_SECONDS: 60,
    MAIL_SMTP_WORKER_INTERVAL_MS: 1_000,
    MAIL_OUTBOX_RETENTION_DAYS: 30,
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
    await prisma.feedbackReport.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('accepts reports without read access and exposes the queue only to an allowlisted operator', async () => {
    const bootstrap = createApp({ env: baseEnv, prisma })
    const administrator = await register(bootstrap, 'feedback-admin')
    const player = await register(bootstrap, 'feedback-player')
    const ordinary = await register(bootstrap, 'feedback-ordinary')
    const app = createApp({
      env: { ...baseEnv, ADMIN_USER_IDS: [administrator.user.id] },
      prisma,
    })
    const report = {
      category: 'suggestion',
      desiredChange: 'Добавить краткую подсказку перед первым ходом.',
      linkAccount: false,
      problemSolved: 'Новому игроку будет проще понять цель раунда.',
      replyEmail: null,
      technicalContext: {
        browserClass: 'chromium',
        buildSha: 'a'.repeat(40),
        deviceClass: 'desktop',
        errorId: null,
        routeTemplate: '/tutorial',
      },
    }

    const anonymous = await app.request('/api/feedback', {
      body: JSON.stringify(report),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(anonymous.status).toBe(401)

    const forbidden = await app.request('/api/feedback', {
      body: JSON.stringify({ ...report, fullUrl: 'https://game.example/private?token=secret' }),
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(forbidden.status).toBe(400)
    expect(await prisma.feedbackReport.count()).toBe(0)

    const acceptedResponse = await app.request('/api/feedback', {
      body: JSON.stringify(report),
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(acceptedResponse.status).toBe(201)
    expect(acceptedResponse.headers.get('cache-control')).toBe('no-store')
    const receipt = feedbackReceiptSchema.parse(await acceptedResponse.json())

    const playerRead = await app.request(`/api/feedback/${receipt.publicNumber}`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    })
    expect(playerRead.status).toBe(404)

    for (const authorization of [undefined, `Bearer ${ordinary.accessToken}`]) {
      const denied = await app.request('/api/operations/feedback', {
        headers: authorization ? { Authorization: authorization } : undefined,
      })
      expect(denied.status).toBe(404)
      expect(await denied.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Route not found' },
      })
    }

    const queueResponse = await app.request('/api/operations/feedback?page=1&pageSize=20', {
      headers: { Authorization: `Bearer ${administrator.accessToken}` },
    })
    expect(queueResponse.status).toBe(200)
    expect(queueResponse.headers.get('cache-control')).toBe('no-store')
    const queue = feedbackQueueResponseSchema.parse(await queueResponse.json())
    expect(queue.items).toHaveLength(1)
    expect(queue.items[0]).toMatchObject({
      linkedAccountId: null,
      publicNumber: receipt.publicNumber,
      status: 'new',
      version: 1,
    })

    const command = {
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      expectedVersion: 1,
    }
    const deniedCommand = await app.request(`/api/operations/feedback/${queue.items[0].id}/take`, {
      body: JSON.stringify(command),
      headers: {
        Authorization: `Bearer ${ordinary.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(deniedCommand.status).toBe(404)

    const commandResponse = await app.request(`/api/operations/feedback/${queue.items[0].id}/take`, {
      body: JSON.stringify(command),
      headers: {
        Authorization: `Bearer ${administrator.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(commandResponse.status).toBe(200)
    expect(await commandResponse.json()).toEqual({
      commandId: command.commandId,
      reportId: queue.items[0].id,
      version: 2,
    })

    const replay = await app.request(`/api/operations/feedback/${queue.items[0].id}/take`, {
      body: JSON.stringify(command),
      headers: {
        Authorization: `Bearer ${administrator.accessToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(replay.status).toBe(200)
    expect(await prisma.feedbackAuditEvent.count()).toBe(1)

    const openApi = await (await app.request('/openapi.json')).json()
    expect(openApi.paths).toHaveProperty('/api/feedback')
    expect(JSON.stringify(openApi)).not.toContain('/api/operations/feedback')
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
    refreshToken: string
    user: { id: string }
  }>
}
