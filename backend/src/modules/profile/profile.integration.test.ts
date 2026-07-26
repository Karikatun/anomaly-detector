import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import type { AppEnv } from '../../env'

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
      }),
    })
    const { accessToken, user } = await registration.json()
    const guest = await prisma.user.create({
      data: { login: 'profile-guest', passwordHash: 'hash' },
    })
    const tender = await prisma.tender.create({
      data: {
        auditEvents: {
          create: [
            {
              actorId: user.id,
              kind: 'scientific_model_scored',
              payload: { correctProperties: 9, playerId: user.id },
              sequence: 1,
            },
            {
              actorId: user.id,
              kind: 'contract_bid_assessed',
              payload: { awarded: true, playerId: user.id },
              sequence: 2,
            },
          ],
        },
        phase: 'complete',
        state: {
          budgetByPlayer: { [guest.id]: 4, [user.id]: 3 },
          players: [{ id: user.id }, { id: guest.id }],
          publicTheses: [{ correct: true, playerId: user.id }],
          ratingByPlayer: { [user.id]: 11 },
          winnerPlayerIds: [user.id],
        },
        version: 1,
      },
    })
    await prisma.tenderRoom.create({
      data: {
        capacity: 2,
        hostId: user.id,
        members: {
          create: [
            { seat: 1, userId: user.id },
            { seat: 2, userId: guest.id },
          ],
        },
        status: 'started',
        tenderId: tender.id,
      },
    })

    const response = await app.request('/api/profile/statistics', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      averagePlacement: 1,
      averageRating: 11,
      contractSuccessRate: 1,
      matchesPlayed: 1,
      modelAccuracy: 0.75,
      wins: 1,
      winRate: 1,
    })
  })
})
