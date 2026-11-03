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
    API_HOST: '0.0.0.0',
    ACCESS_TOKEN_TTL_SECONDS: 60,
    ANALYTICS_CAMPAIGN_ALLOWLIST: [],
    ANALYTICS_ENABLED: false,
    ANALYTICS_MODE: 'aggregate',
    ROOM_BOT_CREATION_DISABLED: false,
    ANALYTICS_ORIGINS: [],
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
    ADMIN_USER_IDS: [],
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
  const app = createApp({ env, prisma })

  async function registerTutorialPlayer(login: string, target = app) {
    const response = await target.request('/api/auth/token/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: 'password123', privacyConsent: true, privacyConsentVersion: '1.1', termsAccepted: true, termsVersion: '1.1' }),
    })
    expect(response.status).toBe(201)
    return await response.json() as { accessToken: string; user: { id: string } }
  }

  beforeEach(async () => {
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
    await prisma.authAbuseBucket.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('keeps both mode statistics readable after all participants abandon their matches', async () => {
    const registration = await app.request('/api/auth/token/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'profile-abandoned', password: 'password123', privacyConsent: true, privacyConsentVersion: '1.1', termsAccepted: true, termsVersion: '1.1' }),
    })
    expect(registration.status).toBe(201)
    const session = await registration.json() as { accessToken: string; user: { id: string } }
    const guest = await prisma.user.create({ data: { login: 'profile-abandoned-guest', passwordHash: 'hash' } })
    const now = new Date()
    for (const mode of ['simple', 'standard'] as const) {
      const module = createTenderModule({ now: () => now, store: createPrismaTenderStore(prisma) })
      const { tenderId } = await module.createTender({ mode, players: [{ id: session.user.id, tiePriority: 1 }, { id: guest.id, tiePriority: 2 }] })
      for (const actorId of [session.user.id, guest.id]) await module.execute({ actorId, commandId: `leave-${actorId}`, tenderId, type: 'leave-tender' })
      await module.advanceDueTenders({ now: new Date(now.getTime() + 6_000), limit: 10 })
      expect((await createTenderModule({ store: createPrismaTenderStore(prisma) }).readTenderView({ tenderId, playerId: session.user.id })).audit).toBeDefined()
    }
    const response = await app.request('/api/profile/statistics/by-mode', { headers: { Authorization: `Bearer ${session.accessToken}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ standard: { matchesPlayed: 1, wins: 0 }, simple: { matchesPlayed: 1, wins: 0 } })
    const legacyResponse = await app.request('/api/profile/statistics', { headers: { Authorization: `Bearer ${session.accessToken}` } })
    expect(legacyResponse.status).toBe(200)
    expect(await legacyResponse.json()).toMatchObject({ matchesPlayed: 1, wins: 0 })
  })

  test('returns persisted completed-match statistics only to the authenticated player', async () => {
    const registration = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'profile-player',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
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
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
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

  test('keeps actual base completion separate from a late legacy completion', async () => {
    const registration = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'tutorial-versioned-player', password: 'password123', privacyConsent: true,
        privacyConsentVersion: '1.1', termsAccepted: true, termsVersion: '1.1',
      }),
    })
    expect(registration.status).toBe(201)
    const { accessToken } = await registration.json()
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    const initial = await app.request('/api/profile/tutorial/progress', { headers })
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({
      schemaVersion: 1,
      base: { legacyCredit: null, completion: null },
      additional: { completion: null },
    })

    const complete = () => app.request('/api/profile/tutorial/progress', {
      method: 'PUT', headers,
      body: JSON.stringify({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' }),
    })
    const first = await complete()
    expect(first.status).toBe(200)
    const firstProgress = await first.json()
    expect(firstProgress.base.completion).toEqual({
      origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: expect.any(String),
    })
    expect(firstProgress.base.legacyCredit).toBeNull()
    expect(await (await complete()).json()).toEqual(firstProgress)

    const legacy = await app.request('/api/profile/tutorial/completion', { method: 'PUT', headers })
    expect(legacy.status).toBe(200)
    const legacyMarker = await legacy.json()
    expect(Object.keys(legacyMarker)).toEqual(['completedAt'])
    const merged = await app.request('/api/profile/tutorial/progress', { headers })
    expect(await merged.json()).toEqual({
      ...firstProgress,
      base: { ...firstProgress.base, legacyCredit: { origin: 'legacy', completedAt: legacyMarker.completedAt } },
    })
    expect(await (await app.request('/api/profile/tutorial', { headers })).json()).toEqual(legacyMarker)
  })

  test('preserves unknown legacy credit and existing additional completion when base is completed', async () => {
    const player = await registerTutorialPlayer('tutorial-legacy-unknown')
    const headers = { Authorization: `Bearer ${player.accessToken}`, 'Content-Type': 'application/json' }
    const additionalAt = '2026-09-04T11:00:00.000Z'
    await prisma.tutorialCompletionRecord.create({ data: {
      userId: player.user.id, lessonId: 'additional', versionKey: 'additional-standard-v1', origin: 'scenario', completedAt: new Date(additionalAt),
    } })
    const save = (command: unknown) => app.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify(command) })
    const credit = await save({ kind: 'legacy-credit' })
    expect(credit.status).toBe(200)
    const credited = await credit.json()
    expect(credited).toEqual({
      schemaVersion: 1,
      base: { legacyCredit: { origin: 'legacy', completedAt: null }, completion: null },
      additional: { completion: { origin: 'scenario', scenarioVersion: 'additional-standard-v1', completedAt: additionalAt } },
    })
    expect(await (await save({ kind: 'legacy-credit' })).json()).toEqual(credited)
    expect(await (await app.request('/api/profile/tutorial', { headers })).json()).toEqual({ completedAt: null })
    const completed = await save({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
    expect(completed.status).toBe(200)
    const progress = await completed.json()
    expect(progress.base.legacyCredit).toEqual({ origin: 'legacy', completedAt: null })
    expect(progress.base.completion).toMatchObject({ origin: 'scenario', scenarioVersion: 'base-simple-v1' })
    expect(progress.additional).toEqual(credited.additional)
    expect(await (await save({ kind: 'legacy-credit' })).json()).toEqual(progress)
  })

  test('serializes duplicate new completions and old legacy writes across app instances', async () => {
    const player = await registerTutorialPlayer('tutorial-parallel')
    const competingPrisma = createPrisma(databaseUrl!)
    const competingApp = createApp({ env, prisma: competingPrisma })
    const headers = { Authorization: `Bearer ${player.accessToken}`, 'Content-Type': 'application/json' }
    const command = JSON.stringify({ kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' })
    try {
      const responses = await Promise.all([
        app.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: command }),
        competingApp.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: command }),
        competingApp.request('/api/profile/tutorial/completion', { method: 'PUT', headers }),
      ])
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
      const [first, second, legacy] = await Promise.all(responses.map((response) => response.json()))
      expect(first.base.completion).toEqual(second.base.completion)
      const latest = await (await app.request('/api/profile/tutorial/progress', { headers })).json()
      expect(latest.base).toEqual({ legacyCredit: { origin: 'legacy', completedAt: legacy.completedAt }, completion: first.base.completion })
    } finally {
      await competingPrisma.$disconnect()
    }
  })

  test('isolates progress by authenticated account and rejects unbounded completion payloads', async () => {
    const owner = await registerTutorialPlayer('tutorial-owner')
    const outsider = await registerTutorialPlayer('tutorial-outsider')
    const headers = { Authorization: `Bearer ${owner.accessToken}`, 'Content-Type': 'application/json' }
    expect((await app.request('/api/profile/tutorial/progress')).status).toBe(401)
    expect((await app.request('/api/profile/tutorial/progress', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    for (const command of [
      { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'unknown' },
      { kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1' },
      { kind: 'legacy-credit', userId: outsider.user.id },
      { kind: 'legacy-credit', completedAt: '2026-09-04T11:00:00.000Z' },
    ]) expect((await app.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify(command) })).status).toBe(400)
    expect((await app.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify({ kind: 'legacy-credit' }) })).status).toBe(200)
    const other = await app.request(`/api/profile/tutorial/progress?userId=${owner.user.id}`, { headers: { Authorization: `Bearer ${outsider.accessToken}` } })
    expect(await other.json()).toEqual({ schemaVersion: 1, base: { legacyCredit: null, completion: null }, additional: { completion: null } })
  })

  test('shares mutation limits with lesson writes without limiting progress reads', async () => {
    const constrainedApp = createApp({ env: { ...env, ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT: 2 }, prisma })
    const player = await registerTutorialPlayer('tutorial-new-budget', constrainedApp)
    const headers = { Authorization: `Bearer ${player.accessToken}`, 'Content-Type': 'application/json' }
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await constrainedApp.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify({ kind: 'legacy-credit' }) })).status).toBe(200)
    }
    const limited = await constrainedApp.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify({ kind: 'legacy-credit' }) })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await constrainedApp.request('/api/profile/tutorial/progress', { headers })).status).toBe(200)
  })

  test('erases lesson records and denies replay after account deletion', async () => {
    const player = await registerTutorialPlayer('tutorial-erasure')
    const headers = { Authorization: `Bearer ${player.accessToken}`, 'Content-Type': 'application/json' }
    for (const command of [{ kind: 'legacy-credit' }, { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' }]) {
      expect((await app.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify(command) })).status).toBe(200)
    }
    expect((await app.request('/api/auth/account', { method: 'DELETE', headers })).status).toBe(204)
    expect((await app.request('/api/profile/tutorial/progress', { method: 'PUT', headers, body: JSON.stringify({ kind: 'legacy-credit' }) })).status).toBe(401)
    expect((await app.request('/api/profile/tutorial/progress', { headers })).status).toBe(401)
    // Data erasure itself cannot be proved by an inaccessible API response alone.
    expect(await prisma.tutorialCompletionRecord.count({ where: { userId: player.user.id } })).toBe(0)
  })

  test('shares the authenticated mutation budget with tutorial completion', async () => {
    const constrainedApp = createApp({
      env: { ...env, ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT: 2 },
      prisma,
    })
    const registration = await constrainedApp.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'tutorial-budget-player',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await registration.json()
    const headers = { Authorization: `Bearer ${accessToken}` }

    expect((await constrainedApp.request('/api/profile/tutorial/completion', {
      method: 'PUT',
      headers,
    })).status).toBe(200)
    expect((await constrainedApp.request('/api/profile/tutorial/completion', {
      method: 'PUT',
      headers,
    })).status).toBe(200)

    const limited = await constrainedApp.request('/api/profile/tutorial/completion', {
      method: 'PUT',
      headers,
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authenticated mutation requests',
      },
    })
    expect((await constrainedApp.request('/api/profile/tutorial', { headers })).status).toBe(200)
  })
})
