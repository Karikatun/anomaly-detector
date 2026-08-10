import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'
import { createPrismaTenderStore, createTenderModule } from '../tender'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('profile statistics API integration', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const env: AppEnv = {
    ACCESS_TOKEN_TTL_SECONDS: 60,
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 60,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    COOKIE_SECURE: false,
    CORS_ORIGINS: ['http://localhost:5173'],
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '12345678901234567890123456789012',
    ADMIN_USER_IDS: [],
    PORT: 3000,
    REFRESH_REUSE_GRACE_SECONDS: 10,
    REFRESH_TOKEN_TTL_DAYS: 30,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    SHUTDOWN_GRACE_SECONDS: 20,
    SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
    SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
    SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    SPACES_UPLOAD_URL_TTL_SECONDS: 900,
    TRUST_PROXY: false,
  }
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('returns persisted completed-match statistics only to the authenticated player', async () => {
    const registration = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'profile-player',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const { accessToken, user } = await registration.json()
    const guest = await prisma.user.create({
      data: { login: 'profile-guest', passwordHash: 'hash' },
    })
    const store = createPrismaTenderStore(prisma)
    const tenderModule = createTenderModule({
      seedGenerator: () => 'profile-statistics-seed',
      store,
    })
    const players = [
      { id: user.id, tiePriority: 1 },
      { id: guest.id, tiePriority: 2 },
    ]
    const completed = await tenderModule.createTender({ players })
    const completedState = await store.read(completed.tenderId)
    if (!completedState) throw new Error('Expected persisted completed Tender fixture')
    await store.commit({
      auditEvents: [],
      expectedVersion: completedState.version,
      nextTender: {
        ...completedState,
        budgetByPlayer: { [guest.id]: 4, [user.id]: 3 },
        certifiedSignalsByPlayer: { [user.id]: ['aster'] },
        dueAt: null,
        phase: 'complete',
        ratingByPlayer: { [user.id]: 11 },
        version: completedState.version + 1,
        winnerPlayerIds: [user.id],
      },
      tenderId: completed.tenderId,
    })
    await prisma.tenderAuditEvent.createMany({
      data: [
        {
          actorId: user.id,
          kind: 'scientific_model_scored',
          payload: { correctProperties: 9, playerId: user.id },
          sequence: 1,
          tenderId: completed.tenderId,
        },
        {
          actorId: user.id,
          kind: 'contract_bid_assessed',
          payload: { awarded: true, playerId: user.id },
          sequence: 2,
          tenderId: completed.tenderId,
        },
      ],
    })

    const early = await tenderModule.createTender({ players })
    const earlyState = await store.read(early.tenderId)
    if (!earlyState) throw new Error('Expected persisted early-completion Tender fixture')
    await store.commit({
      auditEvents: [],
      expectedVersion: earlyState.version,
      nextTender: {
        ...earlyState,
        budgetByPlayer: { [guest.id]: 100, [user.id]: 0 },
        certifiedSignalsByPlayer: { [guest.id]: ['aster', 'boreal'] },
        completionReason: 'last_active_player',
        dueAt: null,
        forfeitedAtByPlayer: { [guest.id]: '2026-07-29T10:00:00.000Z' },
        phase: 'complete',
        ratingByPlayer: { [guest.id]: 100, [user.id]: 0 },
        version: earlyState.version + 1,
        winnerPlayerIds: [user.id],
      },
      tenderId: early.tenderId,
    })
    await prisma.tenderAuditEvent.create({
      data: {
        actorId: user.id,
        kind: 'contract_bid_assessed',
        payload: { awarded: false, playerId: user.id },
        sequence: 1,
        tenderId: early.tenderId,
      },
    })

    const response = await app.request('/api/profile/statistics', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      averagePlacement: 1,
      averageRating: 11,
      contractSuccessRate: 0.5,
      matchesPlayed: 2,
      modelAccuracy: 0.75,
      wins: 2,
      winRate: 1,
    })
  })

  test('persists one idempotent tutorial completion marker for the authenticated account', async () => {
    const registration = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'tutorial-player',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.0',
        termsVersion: '1.0',
      }),
    })
    const { accessToken } = await registration.json()
    const headers = { Authorization: `Bearer ${accessToken}` }

    const initial = await app.request('/api/profile/tutorial', { headers })
    expect(await initial.json()).toEqual({ completedAt: null })

    const completed = await app.request('/api/profile/tutorial/completion', {
      method: 'PUT',
      headers,
    })
    const firstMarker = await completed.json() as { completedAt: string }
    expect(firstMarker.completedAt).toBeString()

    const repeated = await app.request('/api/profile/tutorial/completion', {
      method: 'PUT',
      headers,
    })
    expect(await repeated.json()).toEqual(firstMarker)

    const stored = await app.request('/api/profile/tutorial', { headers })
    expect(await stored.json()).toEqual(firstMarker)
  })
})
