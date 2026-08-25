import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash, createHmac } from 'node:crypto'

import { createApp } from '../../app'
import { createPrisma, type DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { SecurityEvent } from '../../security/events'
import { createPrismaAuthRepository } from './infrastructure/auth-repository'
import { signAccessToken } from './infrastructure/access-tokens'
import { createRoomStartModule } from '../room'
import { createPersistentTenderModule } from '../tender'
import {
  createTransactionalMailRequester,
  deriveAccountEmailConfirmationCode,
  derivePasswordResetToken,
} from '../mail'

const databaseUrl = process.env.TEST_DATABASE_URL

const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('auth API integration', () => {
  const env: AppEnv = {
    PORT: 3000,
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '12345678901234567890123456789012',
    ADMIN_USER_IDS: [],
    ANALYTICS_ENABLED: false,
    ANALYTICS_ORIGINS: [],
    ANALYTICS_CAMPAIGN_ALLOWLIST: [],
    CORS_ORIGINS: ['http://localhost:5173'],
    WEBAPP_ORIGIN: 'http://localhost:5173',
    ACCESS_TOKEN_TTL_SECONDS: 60,
    REFRESH_TOKEN_TTL_DAYS: 30,
    REFRESH_REUSE_GRACE_SECONDS: 10,
    SESSION_ABSOLUTE_TTL_DAYS: 90,
    SESSION_RETENTION_DAYS: 7,
    AUTH_BODY_LIMIT_BYTES: 64 * 1024,
    AUTH_RATE_LIMIT_MAX: 1_000,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    SHUTDOWN_GRACE_SECONDS: 20,
    TRUST_PROXY: true,
    TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-test-client-ip',
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
    YANDEX_STORAGE_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
    YANDEX_STORAGE_UPLOAD_URL_TTL_SECONDS: 900,
    YANDEX_STORAGE_DOWNLOAD_URL_TTL_SECONDS: 300,
    YANDEX_STORAGE_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  }
  const prisma = createPrisma(databaseUrl!)
  const securityEvents: SecurityEvent[] = []
  const app = createApp({
    env,
    prisma,
    securityEvents: {
      emit: (event) => {
        securityEvents.push(event)
      },
    },
  })

  beforeEach(async () => {
    securityEvents.length = 0
    await prisma.mailDeliveryAttempt.deleteMany()
    await prisma.mailOutboxMessage.deleteMany()
    await prisma.mailPolicyEntry.deleteMany()
    await prisma.mailPolicyVersion.deleteMany()
    await prisma.mailRegistryCandidate.deleteMany()
    await prisma.mailRegistryImport.deleteMany()
    await prisma.authAbuseBucket.deleteMany()
    await prisma.tenderRoomMember.deleteMany()
    await prisma.tenderRoom.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('registers, reads me, refreshes, and logs out', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        login: 'user',
        password: 'password123',
        displayName: 'User',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const registerBody = await register.json()

    expect(register.status).toBe(201)
    expect(registerBody.user.login).toBe('user')
    expect(registerBody.accessToken).toBeString()
    expect(registerBody.refreshToken).toBeString()
    expect(register.headers.get('set-cookie')).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({
      where: { login: 'user' },
      select: {
        privacyConsentAt: true,
        privacyConsentVersion: true,
        termsAcceptedAt: true,
        termsVersion: true,
      },
    })).toEqual({
      privacyConsentAt: expect.any(Date),
      privacyConsentVersion: '1.1',
      termsAcceptedAt: expect.any(Date),
      termsVersion: '1.1',
    })

    const me = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(me.status).toBe(200)
    const meBody = await me.json()
    expect(meBody).toEqual({ user: registerBody.user })
    expect('sessionId' in meBody.user).toBe(false)

    const protection = await app.request('/api/auth/account-protection', {
      headers: { Authorization: `Bearer ${registerBody.accessToken}` },
    })
    expect(protection.status).toBe(200)
    expect(await protection.json()).toEqual({
      accountProtection: { state: 'password_unprotected' },
    })

    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const refreshBody = await refresh.json()
    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeString()
    expect(refreshBody.refreshToken).not.toBe(registerBody.refreshToken)
    expect(refresh.headers.get('set-cookie')).toBeNull()

    const meWithPreRefreshAccessToken = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${registerBody.accessToken}`,
      },
    })
    expect(meWithPreRefreshAccessToken.status).toBe(200)

    const sessionsAfterRefresh = await prisma.authSession.count({
      where: {
        user: {
          login: 'user',
        },
      },
    })
    expect(sessionsAfterRefresh).toBe(1)

    const staleRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
    })
    const staleRefreshBody = await staleRefresh.json()
    expect(staleRefresh.status).toBe(200)
    expect(staleRefreshBody.refreshToken).toBeString()

    const logout = await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: staleRefreshBody.refreshToken }),
    })
    expect(logout.status).toBe(204)

    const revokedRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken: staleRefreshBody.refreshToken }),
    })
    expect(revokedRefresh.status).toBe(401)
  })

  test('starts first Recovery Email protection without persisting the plaintext code', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'first-recovery-email',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const account = await register.json()

    const started = await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.11',
      },
      body: JSON.stringify({ email: 'Player@mail.ru', password: 'password123' }),
    })

    expect(started.status).toBe(200)
    expect(await started.json()).toEqual({
      accountProtection: {
        canCancel: true,
        codeExpiresAt: expect.any(String),
        maskedAccountEmail: 'P***@mail.ru',
        state: 'password_pending_code',
      },
    })
    const outbox = await prisma.mailOutboxMessage.findFirstOrThrow({
      where: { templateKind: 'account_email_confirmation' },
    })
    expect(outbox.recipient).toBe('Player@mail.ru')
    expect(outbox.templatePayload).toEqual({
      addressRole: 'recovery',
      expiresAt: expect.any(String),
      kind: 'account_email_confirmation',
    })
    expect(JSON.stringify(outbox)).not.toContain('password123')
    expect(JSON.stringify(outbox.templatePayload)).not.toMatch(/\d{6}/)
    const recoveryOwner = await prisma.user.findUniqueOrThrow({
      where: { login: 'first-recovery-email' },
      select: { id: true },
    })
    const challenge = await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: recoveryOwner.id },
      select: { codeHash: true, policyVersion: true },
    })
    expect(challenge).toEqual({ codeHash: expect.stringMatching(/^[a-f0-9]{64}$/), policyVersion: 1 })
    const recoveryBudgets = await prisma.authAbuseBucket.findMany({
      where: { scope: { startsWith: 'rec_email_' } },
      select: { keyHash: true, scope: true },
    })
    expect(recoveryBudgets).toHaveLength(7)
    expect(recoveryBudgets.every((budget) => /^[a-f0-9]{64}$/.test(budget.keyHash))).toBe(true)
    const expectedAccountHourKey = createHmac('sha256', env.JWT_SECRET)
      .update('recovery-email-budget-v1\0')
      .update('rec_email_account_hour')
      .update('\0')
      .update(recoveryOwner.id)
      .digest('hex')
    const legacyPlainDigest = createHash('sha256')
      .update(`rec_email_account_hour:${recoveryOwner.id}`)
      .digest('hex')
    expect(recoveryBudgets).toContainEqual({
      keyHash: expectedAccountHourKey,
      scope: 'rec_email_account_hour',
    })
    expect(recoveryBudgets.some((budget) => budget.keyHash === legacyPlainDigest)).toBe(false)
    const storedBudgets = JSON.stringify(recoveryBudgets)
    expect(storedBudgets).not.toContain('Player@mail.ru')
    expect(storedBudgets).not.toContain('player@mail.ru')
    expect(storedBudgets).not.toContain('198.51.100.11')
    expect(storedBudgets).not.toContain(recoveryOwner.id)
  })

  test('invalidates the old code on resend and confirms one cooling-off Recovery Email', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'confirm-first-recovery-email',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const account = await register.json()
    const authHeaders = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.12',
    }

    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: 'Player@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    const firstMessage = await prisma.mailOutboxMessage.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    })
    const oldCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, firstMessage.messageId)

    const earlyResend = await app.request('/api/auth/account-protection/recovery-email/resend', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    })
    expect(earlyResend.status).toBe(429)
    expect(await earlyResend.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Recovery Email request is temporarily unavailable',
      },
    })
    const retryAfter = Number(earlyResend.headers.get('retry-after'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    await prisma.authAbuseBucket.updateMany({
      where: { scope: { endsWith: '_min' } },
      data: { expiresAt: new Date(Date.now() - 1) },
    })

    const resend = (target: ReturnType<typeof createApp>) => target.request(
      '/api/auth/account-protection/recovery-email/resend',
      { method: 'POST', headers: authHeaders, body: '{}' },
    )
    const concurrentResends = await Promise.all([
      resend(createApp({ env, prisma })),
      resend(createApp({ env, prisma })),
    ])
    expect(concurrentResends.map((response) => response.status).sort()).toEqual([200, 429])
    const limitedResend = concurrentResends.find((response) => response.status === 429)!
    expect(await limitedResend.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Recovery Email request is temporarily unavailable',
      },
    })
    const concurrentRetryAfter = Number(limitedResend.headers.get('Retry-After'))
    expect(concurrentRetryAfter).toBeGreaterThan(0)
    expect(concurrentRetryAfter).toBeLessThanOrEqual(60)
    const messages = await prisma.mailOutboxMessage.findMany({ orderBy: { createdAt: 'asc' } })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      lastFailureCode: 'owner_operation_cancelled',
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    })
    const newCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, messages[1].messageId)
    expect(newCode).not.toBe(oldCode)
    const restartedApp = createApp({ env, prisma })

    const oldConfirmation = await restartedApp.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ code: oldCode }),
    })
    expect(oldConfirmation.status).toBe(400)
    expect(await oldConfirmation.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Confirmation code is invalid or expired' },
    })

    const confirmed = await restartedApp.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ code: newCode }),
    })
    expect(confirmed.status).toBe(200)
    const confirmedText = await confirmed.text()
    expect(JSON.parse(confirmedText)).toEqual({
      accountProtection: {
        activatesAt: expect.any(String),
        canCancel: true,
        maskedAccountEmail: 'P***@mail.ru',
        state: 'password_cooling_off',
      },
    })
    expect(confirmedText).not.toContain('Player@mail.ru')
    expect((await restartedApp.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ code: newCode }),
    })).status).toBe(200)
    expect(await prisma.recoveryEmailChallenge.count()).toBe(0)
    expect(await prisma.recoveryEmailBinding.count()).toBe(1)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: messages[1].messageId },
      select: { lastFailureCode: true, recipient: true, state: true, templatePayload: true },
    })).toEqual({
      lastFailureCode: 'owner_operation_cancelled',
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    })

    await prisma.recoveryEmailBinding.updateMany({
      data: { activatesAt: new Date(Date.now() - 1) },
    })
    const active = await restartedApp.request('/api/auth/account-protection', {
      headers: authHeaders,
    })
    expect(active.status).toBe(200)
    expect(await active.json()).toEqual({
      accountProtection: {
        maskedAccountEmail: 'P***@mail.ru',
        recoveryCodes: 'not_issued',
        state: 'password_active',
      },
    })
  })

  test('keeps the old Recovery Email authoritative until both replacement codes commit atomically', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const current = await registerTokenAccount('replace-recovery-email')
    const currentHeaders = {
      Authorization: `Bearer ${current.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.18',
    }
    const otherLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'replace-recovery-email', password: 'password123' }),
    })
    expect(otherLogin.status).toBe(200)
    const other = await otherLogin.json()
    await prisma.recoveryEmailBinding.create({
      data: {
        activatesAt: new Date(Date.now() - 60_000),
        cancellationSessionIds: [],
        canonicalKey: 'old@mail.ru',
        policyVersion: 1,
        providerValue: 'Old@mail.ru',
        requestedAt: new Date(Date.now() - 86_400_000),
        userId: current.user.id,
      },
    })
    const issuedCodesResponse = await app.request(
      '/api/auth/account-protection/recovery-codes/issue',
      { method: 'POST', headers: currentHeaders, body: '{}' },
    )
    expect(issuedCodesResponse.status).toBe(200)
    const codeInvalidatedByReplacement = (await issuedCodesResponse.json()).recoveryCodes[0] as string

    const started = await app.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify({ email: 'New@mail.ru', password: 'password123' }),
      },
    )
    expect(started.status).toBe(200)
    const replacementBudgets = await prisma.authAbuseBucket.findMany({
      where: { scope: { startsWith: 'rec_email_' } },
      orderBy: [{ scope: 'asc' }, { keyHash: 'asc' }],
      select: { count: true, keyHash: true, scope: true },
    })
    const countsFor = (scope: string) => replacementBudgets
      .filter((bucket) => bucket.scope === scope)
      .map((bucket) => bucket.count)
      .sort((left, right) => left - right)
    expect(countsFor('rec_email_account_min')).toEqual([1])
    expect(countsFor('rec_email_account_hour')).toEqual([2])
    expect(countsFor('rec_email_account_day')).toEqual([2])
    expect(countsFor('rec_email_address_min')).toEqual([1, 1])
    expect(countsFor('rec_email_address_hour')).toEqual([1, 1])
    expect(countsFor('rec_email_address_day')).toEqual([1, 1])
    expect(countsFor('rec_email_ip_hour')).toEqual([2])
    expect(await started.json()).toEqual({
      accountProtection: {
        canManage: true,
        newAddress: {
          codeExpiresAt: expect.any(String),
          maskedAccountEmail: 'N***@mail.ru',
          status: 'pending',
        },
        oldAddress: {
          codeExpiresAt: expect.any(String),
          maskedAccountEmail: 'O***@mail.ru',
          status: 'pending',
        },
        state: 'password_replacing',
      },
      replacement: {
        currentSession: 'active',
        otherSessions: 'unchanged',
        status: 'pending',
      },
    })
    expect(await (await app.request('/api/auth/account-protection', {
      headers: { Authorization: `Bearer ${other.accessToken}` },
    })).json()).toMatchObject({
      accountProtection: {
        canManage: false,
        state: 'password_replacing',
      },
    })

    const messages = await prisma.mailOutboxMessage.findMany({
      where: { templateKind: 'account_email_confirmation' },
    })
    expect(messages).toHaveLength(2)
    const oldMessage = messages.find((message) => message.recipient === 'Old@mail.ru')
    const newMessage = messages.find((message) => message.recipient === 'New@mail.ru')
    expect(oldMessage).toBeDefined()
    expect(newMessage).toBeDefined()
    expect(oldMessage!.templatePayload).toMatchObject({ recoveryPurpose: 'replacement_old' })
    expect(newMessage!.templatePayload).toMatchObject({ recoveryPurpose: 'replacement_new' })
    const oldCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, oldMessage!.messageId)
    const newCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, newMessage!.messageId)

    for (const [path, body] of [
      ['/api/auth/account-protection/recovery-email/replacement/resend', { factor: 'old' }],
      [
        '/api/auth/account-protection/recovery-email/replacement/confirm',
        { code: oldCode, factor: 'old' },
      ],
    ] as const) {
      expect((await app.request(path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${other.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })).status).toBe(403)
    }

    const oldConfirmed = await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify({ code: oldCode, factor: 'old' }),
      },
    )
    expect(oldConfirmed.status).toBe(200)
    expect(await oldConfirmed.json()).toMatchObject({
      accountProtection: {
        newAddress: { status: 'pending' },
        oldAddress: { status: 'confirmed' },
        state: 'password_replacing',
      },
      replacement: { otherSessions: 'unchanged', status: 'pending' },
    })
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: oldMessage!.messageId },
      select: { lastFailureCode: true, recipient: true, state: true, templatePayload: true },
    })).toEqual({
      lastFailureCode: 'owner_operation_cancelled',
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    })
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: current.user.id },
      select: { canonicalKey: true, providerValue: true },
    })).toEqual({ canonicalKey: 'old@mail.ru', providerValue: 'Old@mail.ru' })

    const completed = await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify({ code: newCode, factor: 'new' }),
      },
    )
    expect(completed.status).toBe(200)
    expect(await completed.json()).toEqual({
      accountProtection: {
        maskedAccountEmail: 'N***@mail.ru',
        recoveryCodes: 'consumed',
        state: 'password_active',
      },
      replacement: {
        currentSession: 'active',
        otherSessions: 'revoked',
        status: 'completed',
      },
    })
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: current.user.id },
      select: { canonicalKey: true, providerValue: true },
    })).toEqual({ canonicalKey: 'new@mail.ru', providerValue: 'New@mail.ru' })
    expect(await prisma.recoveryEmailReplacement.count()).toBe(0)
    expect(await prisma.recoveryCode.count({ where: { userId: current.user.id } })).toBe(0)
    expect(await prisma.recoveryCodeSet.findUniqueOrThrow({
      where: { userId: current.user.id },
      select: { consumedAt: true },
    })).toEqual({ consumedAt: expect.any(Date) })
    expect(await (await app.request('/api/auth/recovery-code/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.89',
      },
      body: JSON.stringify({
        login: 'replace-recovery-email',
        newPassword: 'replacement-must-not-reuse123',
        recoveryCode: codeInvalidatedByReplacement,
      }),
    })).json()).toEqual({ outcome: 'accepted' })

    expect((await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${current.accessToken}` },
    })).status).toBe(200)
    expect((await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${other.accessToken}` },
    })).status).toBe(401)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify({ code: newCode, factor: 'new' }),
      },
    )).status).toBe(400)
    expect(await prisma.mailOutboxMessage.findFirstOrThrow({
      where: { templateKind: 'security_notification' },
      select: { recipient: true, templatePayload: true },
    })).toEqual({
      recipient: 'Old@mail.ru',
      templatePayload: {
        event: 'recovery_email_changed',
        kind: 'security_notification',
        occurredAt: expect.any(String),
      },
    })
  })

  test('keeps replacement factors independent across expiry, attempt exhaustion, resend, and restart', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('bounded-recovery-email-replacement')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.28',
    }
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'bounded-old@mail.ru',
      providerValue: 'Bounded-old@mail.ru',
      userId: account.user.id,
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'Bounded-new@mail.ru', password: 'password123' }),
      },
    )).status).toBe(200)

    let replacement = await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const expiredOldCode = deriveAccountEmailConfirmationCode(
      env.JWT_SECRET,
      replacement.oldMessageId,
    )
    const exhaustedNewCode = deriveAccountEmailConfirmationCode(
      env.JWT_SECRET,
      replacement.newMessageId,
    )
    await prisma.recoveryEmailReplacement.update({
      where: { id: replacement.id },
      data: { oldExpiresAt: new Date(Date.now() - 1) },
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: expiredOldCode, factor: 'old' }),
      },
    )).status).toBe(400)
    expect(await (await app.request('/api/auth/account-protection', { headers })).json()).toMatchObject({
      accountProtection: {
        newAddress: { status: 'pending' },
        oldAddress: { status: 'expired' },
        state: 'password_replacing',
      },
    })

    await expireRecoveryEmailMinuteBudgets(prisma)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/resend',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ factor: 'old' }),
      },
    )).status).toBe(200)
    replacement = await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const validOldCode = deriveAccountEmailConfirmationCode(
      env.JWT_SECRET,
      replacement.oldMessageId,
    )
    expect(validOldCode).not.toBe(expiredOldCode)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: expiredOldCode, factor: 'old' }),
      },
    )).status).toBe(400)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: validOldCode, factor: 'old' }),
      },
    )).status).toBe(200)

    const wrongNewCode = exhaustedNewCode === '000000' ? '000001' : '000000'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.request(
        '/api/auth/account-protection/recovery-email/replacement/confirm',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ code: wrongNewCode, factor: 'new' }),
        },
      )).status).toBe(400)
    }
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: exhaustedNewCode, factor: 'new' }),
      },
    )).status).toBe(400)
    expect(await (await app.request('/api/auth/account-protection', { headers })).json()).toMatchObject({
      accountProtection: {
        newAddress: { status: 'pending' },
        oldAddress: { status: 'confirmed' },
        state: 'password_replacing',
      },
    })

    await expireRecoveryEmailMinuteBudgets(prisma)
    const hourLimitedResend = await app.request(
      '/api/auth/account-protection/recovery-email/replacement/resend',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ factor: 'new' }),
      },
    )
    expect(hourLimitedResend.status).toBe(429)
    const hourRetryAfter = Number(hourLimitedResend.headers.get('Retry-After'))
    expect(hourRetryAfter).toBeGreaterThan(0)
    expect(hourRetryAfter).toBeLessThanOrEqual(60 * 60)
    await prisma.authAbuseBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { scope: { endsWith: '_hour', startsWith: 'rec_email_' } },
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/resend',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ factor: 'new' }),
      },
    )).status).toBe(200)
    replacement = await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    expect(replacement.oldConfirmedAt).toBeInstanceOf(Date)
    const validNewCode = deriveAccountEmailConfirmationCode(
      env.JWT_SECRET,
      replacement.newMessageId,
    )
    expect(validNewCode).not.toBe(exhaustedNewCode)

    const restartedApp = createApp({ env, prisma })
    expect((await restartedApp.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: exhaustedNewCode, factor: 'new' }),
      },
    )).status).toBe(400)
    const completed = await restartedApp.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: validNewCode, factor: 'new' }),
      },
    )
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      accountProtection: { state: 'password_active' },
      replacement: { otherSessions: 'revoked', status: 'completed' },
    })
  })

  test('commits only one of two concurrent replacements for the same canonical address', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const first = await registerTokenAccount('replacement-race-one')
    const second = await registerTokenAccount('replacement-race-two')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'race-old-one@mail.ru',
      providerValue: 'Race-old-one@mail.ru',
      userId: first.user.id,
    })
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'race-old-two@mail.ru',
      providerValue: 'Race-old-two@mail.ru',
      userId: second.user.id,
    })
    const headers = (account: { accessToken: string }, ipAddress: string) => ({
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': ipAddress,
    })
    const firstHeaders = headers(first, '198.51.100.29')
    const secondHeaders = headers(second, '198.51.100.30')
    const start = (requestHeaders: typeof firstHeaders) => app.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ email: 'Shared@mail.ru', password: 'password123' }),
      },
    )
    expect((await start(firstHeaders)).status).toBe(200)
    await expireRecoveryEmailMinuteBudgets(prisma)
    expect((await start(secondHeaders)).status).toBe(200)

    const replacements = await prisma.recoveryEmailReplacement.findMany()
    expect(replacements).toHaveLength(2)
    const replacementFor = (userId: string) => {
      const replacement = replacements.find((candidate) => candidate.userId === userId)
      if (!replacement) throw new Error('Expected Recovery Email replacement')
      return replacement
    }
    const confirm = (
      requestHeaders: typeof firstHeaders,
      factor: 'new' | 'old',
      code: string,
    ) => app.request('/api/auth/account-protection/recovery-email/replacement/confirm', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ code, factor }),
    })
    const firstReplacement = replacementFor(first.user.id)
    const secondReplacement = replacementFor(second.user.id)
    expect((await confirm(
      firstHeaders,
      'old',
      deriveAccountEmailConfirmationCode(env.JWT_SECRET, firstReplacement.oldMessageId),
    )).status).toBe(200)
    expect((await confirm(
      secondHeaders,
      'old',
      deriveAccountEmailConfirmationCode(env.JWT_SECRET, secondReplacement.oldMessageId),
    )).status).toBe(200)

    const results = await Promise.all([
      confirm(
        firstHeaders,
        'new',
        deriveAccountEmailConfirmationCode(env.JWT_SECRET, firstReplacement.newMessageId),
      ),
      confirm(
        secondHeaders,
        'new',
        deriveAccountEmailConfirmationCode(env.JWT_SECRET, secondReplacement.newMessageId),
      ),
    ])
    expect(results.map((response) => response.status).sort()).toEqual([200, 409])
    const conflict = results.find((response) => response.status === 409)
    expect(await conflict?.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Recovery Email is unavailable' },
    })
    expect(await prisma.recoveryEmailBinding.count({
      where: { canonicalKey: 'shared@mail.ru' },
    })).toBe(1)

    const winningUserId = (await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { canonicalKey: 'shared@mail.ru' },
      select: { userId: true },
    })).userId
    const losingUserId = winningUserId === first.user.id ? second.user.id : first.user.id
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: losingUserId },
      select: { canonicalKey: true },
    })).toEqual({
      canonicalKey: losingUserId === first.user.id
        ? 'race-old-one@mail.ru'
        : 'race-old-two@mail.ru',
    })
    expect(await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: losingUserId },
      select: { newConfirmedAt: true, oldConfirmedAt: true },
    })).toEqual({ newConfirmedAt: null, oldConfirmedAt: expect.any(Date) })
  })

  test('fails a blocked replacement closed and redacts both queued codes on account deletion', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('blocked-recovery-email-replacement')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.31',
    }
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'blocked-old@mail.ru',
      providerValue: 'Blocked-old@mail.ru',
      userId: account.user.id,
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'Blocked-new@mail.ru', password: 'password123' }),
      },
    )).status).toBe(200)
    const replacement = await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const oldCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, replacement.oldMessageId)

    await publishMailServiceState(prisma, 'mail.ru', 'blocked')
    expect(await (await app.request('/api/auth/account-protection', { headers })).json()).toEqual({
      accountProtection: {
        canManage: true,
        newAddress: {
          codeExpiresAt: expect.any(String),
          maskedAccountEmail: 'B***@mail.ru',
          status: 'service_blocked',
        },
        oldAddress: {
          codeExpiresAt: expect.any(String),
          maskedAccountEmail: 'B***@mail.ru',
          status: 'service_blocked',
        },
        state: 'password_replacing',
      },
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: oldCode, factor: 'old' }),
      },
    )).status).toBe(400)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/resend',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ factor: 'new' }),
      },
    )).status).toBe(400)
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { canonicalKey: true },
    })).toEqual({ canonicalKey: 'blocked-old@mail.ru' })

    expect((await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${account.accessToken}` },
    })).status).toBe(204)
    expect(await prisma.recoveryEmailBinding.count({
      where: { userId: account.user.id },
    })).toBe(0)
    expect(await prisma.recoveryEmailReplacement.count({
      where: { userId: account.user.id },
    })).toBe(0)
    expect(await prisma.mailOutboxMessage.findMany({
      where: { messageId: { in: [replacement.oldMessageId, replacement.newMessageId] } },
      select: { lastFailureCode: true, recipient: true, state: true, templatePayload: true },
    })).toEqual([
      {
        lastFailureCode: 'owner_operation_cancelled',
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      },
      {
        lastFailureCode: 'owner_operation_cancelled',
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      },
    ])
  })

  test('does not commit a pending new address after its mail service becomes deprecated', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('deprecated-recovery-email-replacement')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.34',
    }
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'deprecated-old@mail.ru',
      providerValue: 'Deprecated-old@mail.ru',
      userId: account.user.id,
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'Deprecated-new@mail.ru', password: 'password123' }),
      },
    )).status).toBe(200)
    const replacement = await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: deriveAccountEmailConfirmationCode(env.JWT_SECRET, replacement.oldMessageId),
          factor: 'old',
        }),
      },
    )).status).toBe(200)

    await publishMailServiceState(prisma, 'mail.ru', 'deprecated')
    expect(await (await app.request('/api/auth/account-protection', { headers })).json()).toMatchObject({
      accountProtection: {
        newAddress: { status: 'service_blocked' },
        oldAddress: { status: 'confirmed' },
        state: 'password_replacing',
      },
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: deriveAccountEmailConfirmationCode(env.JWT_SECRET, replacement.newMessageId),
          factor: 'new',
        }),
      },
    )).status).toBe(400)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/resend',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ factor: 'new' }),
      },
    )).status).toBe(400)
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { canonicalKey: true },
    })).toEqual({ canonicalKey: 'deprecated-old@mail.ru' })
  })

  test('lets only the initiating session abandon a partial replacement without changing the old address', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const current = await registerTokenAccount('cancel-recovery-email-replacement')
    const otherLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'cancel-recovery-email-replacement',
        password: 'password123',
      }),
    })
    expect(otherLogin.status).toBe(200)
    const other = await otherLogin.json()
    const currentHeaders = {
      Authorization: `Bearer ${current.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.33',
    }
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'cancel-old@mail.ru',
      providerValue: 'Cancel-old@mail.ru',
      userId: current.user.id,
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify({ email: 'Cancel-new@mail.ru', password: 'password123' }),
      },
    )).status).toBe(200)
    const replacement = await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: current.user.id },
    })
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/cancel',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${other.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )).status).toBe(403)
    expect((await app.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      {
        method: 'POST',
        headers: currentHeaders,
        body: JSON.stringify({
          code: deriveAccountEmailConfirmationCode(env.JWT_SECRET, replacement.oldMessageId),
          factor: 'old',
        }),
      },
    )).status).toBe(200)

    const cancelled = await app.request(
      '/api/auth/account-protection/recovery-email/replacement/cancel',
      { method: 'POST', headers: currentHeaders, body: '{}' },
    )
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toEqual({
      accountProtection: {
        maskedAccountEmail: 'C***@mail.ru',
        recoveryCodes: 'not_issued',
        state: 'password_active',
      },
    })
    expect(await prisma.recoveryEmailReplacement.count()).toBe(0)
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: current.user.id },
      select: { canonicalKey: true, providerValue: true },
    })).toEqual({
      canonicalKey: 'cancel-old@mail.ru',
      providerValue: 'Cancel-old@mail.ru',
    })
    expect(await prisma.mailOutboxMessage.count({
      where: {
        messageId: { in: [replacement.oldMessageId, replacement.newMessageId] },
        recipient: '[redacted]',
        state: 'terminal_failure',
      },
    })).toBe(2)
    expect((await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${other.accessToken}` },
    })).status).toBe(200)
  })

  test('rejects an invalid password, an unapproved service, and a Yandex-managed account', async () => {
    const account = await registerTokenAccount('reject-first-recovery-email')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.14',
    }
    const request = (password: string) => app.request(
      '/api/auth/account-protection/recovery-email/start',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'player@mail.ru', password }),
      },
    )

    const wrongPassword = await request('incorrect-password')
    expect(wrongPassword.status).toBe(401)
    expect(await wrongPassword.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Current password is invalid' },
    })
    expect((await request('password123')).status).toBe(400)

    await seedApprovedMailService(prisma, 'mail.ru')
    await prisma.authIdentity.create({
      data: {
        provider: 'yandex',
        subject: 'recovery-email-must-remain-yandex-managed',
        userId: account.user.id,
      },
    })
    const yandexManaged = await request('password123')
    expect(yandexManaged.status).toBe(400)
    expect(await yandexManaged.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Recovery Email is unavailable' },
    })
    expect(await prisma.recoveryEmailChallenge.count()).toBe(0)
    expect(await prisma.mailOutboxMessage.count()).toBe(0)
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'rec_email_' } },
    })).toBe(0)
  })

  test('enforces code expiry and five attempts while a resend resets the challenge', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('bounded-first-recovery-email')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.15',
    }
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'player@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    let challenge = await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const expiredCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    await prisma.recoveryEmailChallenge.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    })
    expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: expiredCode }),
    })).status).toBe(400)

    await expireRecoveryEmailMinuteBudgets(prisma)
    expect((await app.request('/api/auth/account-protection/recovery-email/resend', {
      method: 'POST',
      headers,
      body: '{}',
    })).status).toBe(200)
    challenge = await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const validCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    const wrongCode = validCode === '000000' ? '000001' : '000000'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: wrongCode }),
      })).status).toBe(400)
    }
    expect((await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { attemptCount: true },
    })).attemptCount).toBe(5)
    expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: validCode }),
    })).status).toBe(400)

    await expireRecoveryEmailMinuteBudgets(prisma)
    expect((await app.request('/api/auth/account-protection/recovery-email/resend', {
      method: 'POST',
      headers,
      body: '{}',
    })).status).toBe(200)
    challenge = await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    expect(challenge.attemptCount).toBe(0)
    const replacementCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: replacementCode }),
    })).status).toBe(200)
  })

  test('fails safe when the Recovery Email service becomes blocked', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('blocked-first-recovery-email')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.21',
    }
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'player@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    const challenge = await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const code = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    await publishMailServiceState(prisma, 'mail.ru', 'blocked')

    const view = await app.request('/api/auth/account-protection', { headers })
    expect(await view.json()).toEqual({
      accountProtection: {
        blockedStage: 'pending_code',
        canCancel: true,
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_service_blocked',
      },
    })
    expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code }),
    })).status).toBe(400)
    expect((await app.request('/api/auth/account-protection/recovery-email/resend', {
      method: 'POST',
      headers,
      body: '{}',
    })).status).toBe(400)
    expect((await app.request('/api/auth/account-protection/recovery-email/cancel', {
      method: 'POST',
      headers,
      body: '{}',
    })).status).toBe(200)
  })

  test('gives one safe conflict when two accounts confirm the same canonical Recovery Email', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const first = await registerTokenAccount('recovery-email-owner-one')
    const second = await registerTokenAccount('recovery-email-owner-two')
    const headers = (account: { accessToken: string }, ipAddress: string) => ({
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': ipAddress,
    })
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: headers(first, '198.51.100.16'),
      body: JSON.stringify({ email: 'Player@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    await prisma.authAbuseBucket.updateMany({
      where: { scope: 'rec_email_address_min' },
      data: { expiresAt: new Date(Date.now() - 1) },
    })
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: headers(second, '198.51.100.17'),
      body: JSON.stringify({ email: 'player@mail.ru', password: 'password123' }),
    })).status).toBe(200)

    const challenges = await prisma.recoveryEmailChallenge.findMany()
    expect(challenges).toHaveLength(2)
    const codeFor = (userId: string) => {
      const challenge = challenges.find((candidate) => candidate.userId === userId)
      if (!challenge) throw new Error('Expected Recovery Email challenge')
      return deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    }
    const responses = await Promise.all([
      app.request('/api/auth/account-protection/recovery-email/confirm', {
        method: 'POST',
        headers: headers(first, '198.51.100.16'),
        body: JSON.stringify({ code: codeFor(first.user.id) }),
      }),
      app.request('/api/auth/account-protection/recovery-email/confirm', {
        method: 'POST',
        headers: headers(second, '198.51.100.17'),
        body: JSON.stringify({ code: codeFor(second.user.id) }),
      }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const conflict = responses.find((response) => response.status === 409)
    expect(await conflict?.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Recovery Email is unavailable' },
    })
    expect(await prisma.recoveryEmailBinding.count()).toBe(1)
    expect(await prisma.recoveryEmailChallenge.count()).toBe(1)
  })

  test('serializes confirmation with cancellation without leaving partial protection', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('race-first-recovery-email')
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.18',
    }
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'player@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    const challenge = await prisma.recoveryEmailChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const code = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    const [confirmation, cancellation] = await Promise.all([
      app.request('/api/auth/account-protection/recovery-email/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify({ code }),
      }),
      app.request('/api/auth/account-protection/recovery-email/cancel', {
        method: 'POST',
        headers,
        body: '{}',
      }),
    ])
    expect([200, 400]).toContain(confirmation.status)
    expect(cancellation.status).toBe(200)
    expect(await prisma.recoveryEmailChallenge.count()).toBe(0)
    expect(await prisma.recoveryEmailBinding.count()).toBe(0)
  })

  test('rolls back the Recovery Email owner operation when its outbox write conflicts', async () => {
    const user = await prisma.user.create({
      data: { login: 'recovery-outbox-rollback', passwordHash: 'stored-password-hash' },
    })
    const session = await prisma.authSession.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        refreshTokenFamilyHash: 'rollback-family-hash',
        refreshTokenHash: 'rollback-refresh-hash',
        userId: user.id,
      },
    })
    const messageId = '019f8099-7e26-7760-ad08-66d1d66b2890'
    await prisma.$transaction(async (tx) => {
      await createTransactionalMailRequester(tx, env.JWT_SECRET).enqueue({
        messageId,
        recipient: 'occupied@mail.ru',
        template: {
          expiresAt: new Date(Date.now() + 15 * 60_000),
          kind: 'account_email_confirmation',
        },
      })
    })
    const repository = createPrismaAuthRepository(prisma, env.JWT_SECRET, {
      createMessageId: () => messageId,
    })
    await expect(repository.startRecoveryEmail({
      canonicalKey: 'player@mail.ru',
      expectedPasswordHash: 'stored-password-hash',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      ipAddress: '198.51.100.19',
      now: new Date(Date.now() + 1_000),
      policyVersion: 1,
      providerValue: 'player@mail.ru',
      sessionId: session.id,
      userId: user.id,
    })).rejects.toMatchObject({ kind: 'message_conflict' })
    expect(await prisma.recoveryEmailChallenge.count()).toBe(0)
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'rec_email_' } },
    })).toBe(0)
    expect(await prisma.mailOutboxMessage.count()).toBe(1)
  })

  test('rolls back both replacement factors when either outbox write conflicts', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const user = await prisma.user.create({
      data: {
        login: 'replacement-outbox-rollback',
        passwordHash: 'stored-password-hash',
      },
    })
    const session = await prisma.authSession.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        refreshTokenFamilyHash: 'replacement-rollback-family-hash',
        refreshTokenHash: 'replacement-rollback-refresh-hash',
        userId: user.id,
      },
    })
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'rollback-old@mail.ru',
      providerValue: 'Rollback-old@mail.ru',
      userId: user.id,
    })
    const firstMessageId = '019f8099-7e26-7760-ad08-66d1d66b2891'
    const conflictingMessageId = '019f8099-7e26-7760-ad08-66d1d66b2892'
    await prisma.$transaction(async (tx) => {
      await createTransactionalMailRequester(tx, env.JWT_SECRET).enqueue({
        messageId: conflictingMessageId,
        recipient: 'occupied@mail.ru',
        template: {
          expiresAt: new Date(Date.now() + 15 * 60_000),
          kind: 'account_email_confirmation',
        },
      })
    })
    let createdMessageCount = 0
    const repository = createPrismaAuthRepository(prisma, env.JWT_SECRET, {
      createMessageId: () => {
        createdMessageCount += 1
        return createdMessageCount === 1 ? firstMessageId : conflictingMessageId
      },
    })
    await expect(repository.startRecoveryEmailReplacement({
      expectedPasswordHash: 'stored-password-hash',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      ipAddress: '198.51.100.32',
      newCanonicalKey: 'rollback-new@mail.ru',
      newProviderValue: 'Rollback-new@mail.ru',
      now: new Date(),
      sessionId: session.id,
      userId: user.id,
    })).rejects.toMatchObject({ kind: 'message_conflict' })
    expect(await prisma.recoveryEmailReplacement.count()).toBe(0)
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'rec_email_' } },
    })).toBe(0)
    expect(await prisma.mailOutboxMessage.count()).toBe(1)
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: user.id },
      select: { canonicalKey: true },
    })).toEqual({ canonicalKey: 'rollback-old@mail.ru' })
  })

  test('lets only a pre-request session cancel cooling off and revokes newer sessions', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'cancel-first-recovery-email',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const original = await register.json()
    const originalHeaders = {
      Authorization: `Bearer ${original.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.13',
    }

    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: originalHeaders,
      body: JSON.stringify({ email: 'player@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    const message = await prisma.mailOutboxMessage.findFirstOrThrow()
    const code = deriveAccountEmailConfirmationCode(env.JWT_SECRET, message.messageId)
    expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers: originalHeaders,
      body: JSON.stringify({ code }),
    })).status).toBe(200)

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'cancel-first-recovery-email', password: 'password123' }),
    })
    expect(login.status).toBe(200)
    const newer = await login.json()
    const newerHeaders = {
      Authorization: `Bearer ${newer.accessToken}`,
      'Content-Type': 'application/json',
    }
    const newerView = await app.request('/api/auth/account-protection', {
      headers: newerHeaders,
    })
    expect(await newerView.json()).toEqual({
      accountProtection: {
        activatesAt: expect.any(String),
        canCancel: false,
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_cooling_off',
      },
    })
    const forbidden = await app.request('/api/auth/account-protection/recovery-email/cancel', {
      method: 'POST',
      headers: newerHeaders,
      body: '{}',
    })
    expect(forbidden.status).toBe(403)

    const cancelled = await app.request('/api/auth/account-protection/recovery-email/cancel', {
      method: 'POST',
      headers: originalHeaders,
      body: '{}',
    })
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toEqual({
      accountProtection: { state: 'password_unprotected' },
    })
    expect(await prisma.recoveryEmailBinding.count()).toBe(0)
    expect((await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${newer.accessToken}` },
    })).status).toBe(401)
    expect((await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${original.accessToken}` },
    })).status).toBe(200)
  })

  test('does not transfer Recovery Email cancellation authority after the requester logs out', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('logout-first-recovery-email')
    const originalHeaders = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.19',
    }
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: originalHeaders,
      body: JSON.stringify({ email: 'logout@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    const challenge = await prisma.recoveryEmailChallenge.findFirstOrThrow()
    const code = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    expect((await app.request('/api/auth/account-protection/recovery-email/confirm', {
      method: 'POST',
      headers: originalHeaders,
      body: JSON.stringify({ code }),
    })).status).toBe(200)

    expect((await app.request('/api/auth/token/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: account.refreshToken }),
    })).status).toBe(204)
    expect((await app.request('/api/auth/account-protection/recovery-email/cancel', {
      method: 'POST',
      headers: originalHeaders,
      body: '{}',
    })).status).toBe(401)

    const newer = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'logout-first-recovery-email', password: 'password123' }),
    })
    expect(newer.status).toBe(200)
    const newerAccount = await newer.json()
    const newerHeaders = {
      Authorization: `Bearer ${newerAccount.accessToken}`,
      'Content-Type': 'application/json',
    }
    expect((await app.request('/api/auth/account-protection/recovery-email/cancel', {
      method: 'POST',
      headers: newerHeaders,
      body: '{}',
    })).status).toBe(403)
    expect(await prisma.recoveryEmailBinding.count()).toBe(1)
    expect(await (await app.request('/api/auth/account-protection', {
      headers: newerHeaders,
    })).json()).toEqual({
      accountProtection: {
        activatesAt: expect.any(String),
        canCancel: false,
        maskedAccountEmail: 'l***@mail.ru',
        state: 'password_cooling_off',
      },
    })
  })

  test('issues eight Recovery Codes once and atomically consumes the whole set for a password reset', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('recovery-code-password')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'recovery-code-password@mail.ru',
      providerValue: 'Recovery-code-password@mail.ru',
      userId: account.user.id,
    })
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.71',
    }

    const issued = await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(issued.status).toBe(200)
    const issuedBody = await issued.json()
    expect(issuedBody).toEqual({
      accountProtection: {
        maskedAccountEmail: 'R***@mail.ru',
        recoveryCodes: 'available',
        state: 'password_active',
      },
      recoveryCodes: expect.arrayContaining([
        expect.stringMatching(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/),
      ]),
    })
    expect(issuedBody.recoveryCodes).toHaveLength(8)
    expect(new Set(issuedBody.recoveryCodes).size).toBe(8)

    const stored = await prisma.$queryRaw<Array<{ code_hash: string }>>`
      SELECT code_hash FROM recovery_codes WHERE user_id = ${account.user.id}::uuid
    `
    expect(stored).toHaveLength(8)
    expect(stored.every((row) => /^[a-f0-9]{64}$/.test(row.code_hash))).toBe(true)
    expect(JSON.stringify(stored)).not.toContain(issuedBody.recoveryCodes[0])

    const duplicateIssue = await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(duplicateIssue.status).toBe(409)
    const protection = await app.request('/api/auth/account-protection', { headers })
    expect(await protection.json()).toEqual({
      accountProtection: {
        maskedAccountEmail: 'R***@mail.ru',
        recoveryCodes: 'available',
        state: 'password_active',
      },
    })

    const secondSession = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'recovery-code-password', password: 'password123' }),
    })
    expect(secondSession.status).toBe(200)
    const attempts = await Promise.all([
      app.request('/api/auth/recovery-code/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': '198.51.100.72',
        },
        body: JSON.stringify({
          login: 'recovery-code-password',
          newPassword: 'new-password123',
          recoveryCode: issuedBody.recoveryCodes[0],
        }),
      }),
      app.request('/api/auth/recovery-code/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': '198.51.100.73',
        },
        body: JSON.stringify({
          login: 'recovery-code-password',
          newPassword: 'other-password123',
          recoveryCode: issuedBody.recoveryCodes[0],
        }),
      }),
    ])
    expect(attempts.map((response) => response.status)).toEqual([200, 200])
    const outcomes = await Promise.all(attempts.map((response) => response.json()))
    expect(outcomes.map((body) => body.outcome).sort()).toEqual(['accepted', 'completed'])
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM recovery_codes WHERE user_id = ${account.user.id}::uuid
    `).toEqual([{ count: 0n }])
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: account.user.id },
    })).toBe(0)

    const successfulPassword = outcomes[0].outcome === 'completed'
      ? 'new-password123'
      : 'other-password123'
    expect((await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'recovery-code-password', password: successfulPassword }),
    })).status).toBe(200)
    expect(await (await app.request('/api/auth/recovery-code/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.74',
      },
      body: JSON.stringify({
        login: 'recovery-code-password',
        newPassword: 'replayed-password123',
        recoveryCode: issuedBody.recoveryCodes[0],
      }),
    })).json()).toEqual({ outcome: 'accepted' })
  })

  test('reissues Recovery Codes only after password and active Recovery Email confirmation', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('recovery-code-reissue')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'recovery-code-reissue@mail.ru',
      providerValue: 'Recovery-code-reissue@mail.ru',
      userId: account.user.id,
    })
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.75',
    }
    const initial = await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST', headers, body: '{}',
    })
    const initialCodes = (await initial.json()).recoveryCodes as string[]

    const wrongPassword = await app.request(
      '/api/auth/account-protection/recovery-codes/reissue/start',
      { method: 'POST', headers, body: JSON.stringify({ password: 'wrong-password' }) },
    )
    expect(wrongPassword.status).toBe(401)
    const started = await app.request(
      '/api/auth/account-protection/recovery-codes/reissue/start',
      { method: 'POST', headers, body: JSON.stringify({ password: 'password123' }) },
    )
    expect(started.status).toBe(200)
    expect(await started.json()).toEqual({
      challenge: {
        codeExpiresAt: expect.any(String),
        maskedAccountEmail: 'R***@mail.ru',
      },
    })
    const challenge = await prisma.recoveryCodeReissueChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    expect(challenge.codeHash).toMatch(/^[a-f0-9]{64}$/)
    const emailCode = deriveAccountEmailConfirmationCode(env.JWT_SECRET, challenge.messageId)
    expect((await app.request(
      '/api/auth/account-protection/recovery-codes/reissue/confirm',
      { method: 'POST', headers, body: JSON.stringify({ code: '999999' }) },
    )).status).toBe(400)

    const confirmed = await app.request(
      '/api/auth/account-protection/recovery-codes/reissue/confirm',
      { method: 'POST', headers, body: JSON.stringify({ code: emailCode }) },
    )
    expect(confirmed.status).toBe(200)
    const nextCodes = (await confirmed.json()).recoveryCodes as string[]
    expect(nextCodes).toHaveLength(8)
    expect(nextCodes).not.toEqual(initialCodes)
    expect(await prisma.recoveryCode.count({ where: { userId: account.user.id } })).toBe(8)
    expect(await prisma.recoveryCodeSet.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { consumedAt: true, generation: true },
    })).toEqual({ consumedAt: null, generation: 2 })
    expect(await prisma.recoveryCodeReissueChallenge.count()).toBe(0)

    expect(await (await app.request('/api/auth/recovery-code/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.76',
      },
      body: JSON.stringify({
        login: 'recovery-code-reissue',
        newPassword: 'should-not-win123',
        recoveryCode: initialCodes[0],
      }),
    })).json()).toEqual({ outcome: 'accepted' })
    expect(await prisma.recoveryCode.count({ where: { userId: account.user.id } })).toBe(8)
  })

  test('uses one Recovery Code to confirm a new Recovery Email and keeps failures non-enumerating', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('recovery-code-email')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'old-recovery-code@mail.ru',
      providerValue: 'Old-recovery-code@mail.ru',
      userId: account.user.id,
    })
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
    }
    const issued = await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST', headers, body: '{}',
    })
    const recoveryCode = (await issued.json()).recoveryCodes[0] as string
    const anotherSession = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'recovery-code-email', password: 'password123' }),
    })
    expect(anotherSession.status).toBe(200)

    const unknown = await app.request('/api/auth/recovery-code/recovery-email/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.77',
      },
      body: JSON.stringify({
        email: 'New@mail.ru',
        login: 'missing-recovery-code-email',
        recoveryCode,
      }),
    })
    const badCode = await app.request('/api/auth/recovery-code/recovery-email/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.78',
      },
      body: JSON.stringify({
        email: 'New@mail.ru',
        login: 'recovery-code-email',
        recoveryCode: '0000-0000-0000-0000-0000-0000-0000-0000',
      }),
    })
    expect(unknown.status).toBe(200)
    expect(badCode.status).toBe(200)
    expect(await unknown.json()).toEqual({ outcome: 'accepted' })
    expect(await badCode.json()).toEqual({ outcome: 'accepted' })

    const started = await app.request('/api/auth/recovery-code/recovery-email/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.79',
      },
      body: JSON.stringify({
        email: 'New@mail.ru',
        login: 'recovery-code-email',
        recoveryCode,
      }),
    })
    expect(started.status).toBe(200)
    expect(await started.json()).toEqual({
      codeExpiresAt: expect.any(String),
      maskedAccountEmail: 'N***@mail.ru',
      outcome: 'pending',
    })
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: account.user.id },
    })).toBe(0)
    expect(await prisma.recoveryCode.count({ where: { userId: account.user.id } })).toBe(0)
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { canonicalKey: true },
    })).toEqual({ canonicalKey: 'old-recovery-code@mail.ru' })

    const replacement = await prisma.recoveryCodeEmailReplacement.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    expect(replacement.newCodeHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(replacement)).not.toContain(recoveryCode)
    const confirmationCode = deriveAccountEmailConfirmationCode(
      env.JWT_SECRET,
      replacement.newMessageId,
    )
    const sessionAfterConsumption = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'recovery-code-email', password: 'password123' }),
    })
    expect(sessionAfterConsumption.status).toBe(200)

    const confirmed = await app.request('/api/auth/recovery-code/recovery-email/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.80',
      },
      body: JSON.stringify({ code: confirmationCode, login: 'recovery-code-email' }),
    })
    expect(confirmed.status).toBe(200)
    const confirmedBody = await confirmed.json()
    expect(confirmedBody).toEqual({
      activatesAt: expect.any(String),
      maskedAccountEmail: 'N***@mail.ru',
      outcome: 'completed',
    })
    expect(new Date(confirmedBody.activatesAt).getTime()).toBeGreaterThan(Date.now())
    expect(await prisma.recoveryEmailBinding.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { canonicalKey: true },
    })).toEqual({ canonicalKey: 'new@mail.ru' })
    expect(await prisma.recoveryCodeEmailReplacement.count()).toBe(0)
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: account.user.id },
    })).toBe(0)
    expect(await (await app.request('/api/auth/recovery-code/recovery-email/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.81',
      },
      body: JSON.stringify({ code: confirmationCode, login: 'recovery-code-email' }),
    })).json()).toEqual({ outcome: 'accepted' })
  })

  test('keeps missing and Yandex-owned accounts indistinguishable in public Recovery Code flows', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const yandexUser = await prisma.user.create({ data: { login: 'yandex-recovery-code' } })
    await prisma.authIdentity.create({
      data: {
        provider: 'yandex',
        subject: 'yandex-recovery-code-subject',
        userId: yandexUser.id,
      },
    })
    const recoveryCode = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111'
    const passwordRequest = (login: string, ipAddress: string) =>
      app.request('/api/auth/recovery-code/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-client-ip': ipAddress },
        body: JSON.stringify({ login, newPassword: 'new-password123', recoveryCode }),
      })
    const emailRequest = (login: string, ipAddress: string) =>
      app.request('/api/auth/recovery-code/recovery-email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-test-client-ip': ipAddress },
        body: JSON.stringify({ email: 'new@mail.ru', login, recoveryCode }),
      })

    const responses = await Promise.all([
      passwordRequest('missing-recovery-code', '198.51.100.91'),
      passwordRequest('yandex-recovery-code', '198.51.100.92'),
      emailRequest('missing-recovery-code', '198.51.100.93'),
      emailRequest('yandex-recovery-code', '198.51.100.94'),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { outcome: 'accepted' },
      { outcome: 'accepted' },
      { outcome: 'accepted' },
      { outcome: 'accepted' },
    ])
    expect(await prisma.recoveryCodeEmailReplacement.count()).toBe(0)
    expect(await prisma.authSession.count({ where: { userId: yandexUser.id } })).toBe(0)
  })

  test('atomically expires Recovery Code login budgets without changing the generic response', async () => {
    const secondApp = createApp({ env, prisma })
    const request = (target: typeof app) => target.request('/api/auth/recovery-code/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.95',
      },
      body: JSON.stringify({
        login: 'concurrent-missing-recovery-code',
        newPassword: 'new-password123',
        recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111',
      }),
    })

    const concurrent = await Promise.all([
      request(app),
      request(secondApp),
      request(app),
      request(secondApp),
    ])
    expect(concurrent.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(await Promise.all(concurrent.map((response) => response.json())))
      .toEqual(Array.from({ length: 4 }, () => ({ outcome: 'accepted' })))
    expect(await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'rec_code_login_hour' },
      select: { count: true },
    })).toEqual({ count: 4 })

    await prisma.authAbuseBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { scope: 'rec_code_login_hour' },
    })
    const afterExpiry = await request(secondApp)
    expect(afterExpiry.status).toBe(200)
    expect(await afterExpiry.json()).toEqual({ outcome: 'accepted' })
    expect(await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'rec_code_login_hour' },
      select: { count: true },
    })).toEqual({ count: 1 })
    expect(await prisma.mailOutboxMessage.count()).toBe(0)
  })

  test('does not create login budgets after the Recovery Code IP budget is exhausted', async () => {
    const secondApp = createApp({ env, prisma })
    const request = (target: typeof app, login: string) => target.request(
      '/api/auth/recovery-code/password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': '198.51.100.96',
        },
        body: JSON.stringify({
          login,
          newPassword: 'new-password123',
          recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111',
        }),
      },
    )

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await request(
        attempt % 2 === 0 ? app : secondApp,
        'ip-budgeted-missing-recovery-code',
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ outcome: 'accepted' })
    }
    const loginBudgetRowsBefore = await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'rec_code_login_' } },
    })

    const afterIpExhaustion = await Promise.all(Array.from({ length: 12 }, (_, attempt) =>
      request(
        attempt % 2 === 0 ? app : secondApp,
        `ip-budgeted-missing-recovery-code-${attempt}`,
      )))
    expect(afterIpExhaustion.map((response) => response.status))
      .toEqual(Array.from({ length: 12 }, () => 200))
    expect(await Promise.all(afterIpExhaustion.map((response) => response.json())))
      .toEqual(Array.from({ length: 12 }, () => ({ outcome: 'accepted' })))
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'rec_code_login_' } },
    })).toBe(loginBudgetRowsBefore)
    expect(await prisma.mailOutboxMessage.count()).toBe(0)
  })

  test('keeps password-reset requests generic and queues one hashed short-lived link', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('email-link-recovery')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'email-link-recovery@mail.ru',
      providerValue: 'Email-link-recovery@mail.ru',
      userId: account.user.id,
    })
    const yandexUser = await prisma.user.create({ data: { login: 'yandex-link-recovery' } })
    await prisma.authIdentity.create({
      data: {
        provider: 'yandex',
        subject: 'yandex-link-recovery-subject',
        userId: yandexUser.id,
      },
    })
    await registerTokenAccount('no-email-link-recovery')
    const blockedAccount = await registerTokenAccount('blocked-link-recovery')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'blocked-link-recovery@mail.ru',
      providerValue: 'Blocked-link-recovery@mail.ru',
      userId: blockedAccount.user.id,
    })
    const recoveryApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://app.example.test'],
        WEBAPP_ORIGIN: 'https://app.example.test',
      },
      prisma,
    })
    const requestReset = (login: string, ipAddress: string) => recoveryApp.request(
      '/api/auth/password-recovery/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': ipAddress,
        },
        body: JSON.stringify({ login }),
      },
    )

    const responses = await Promise.all([
      requestReset('missing-link-recovery', '198.51.100.101'),
      requestReset('yandex-link-recovery', '198.51.100.102'),
      requestReset('email-link-recovery', '198.51.100.103'),
      requestReset('no-email-link-recovery', '198.51.100.104'),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { outcome: 'accepted' },
      { outcome: 'accepted' },
      { outcome: 'accepted' },
      { outcome: 'accepted' },
    ])

    await publishMailServiceState(prisma, 'mail.ru', 'blocked')
    const blockedResponse = await requestReset('blocked-link-recovery', '198.51.100.105')
    expect(blockedResponse.status).toBe(200)
    expect(await blockedResponse.json()).toEqual({ outcome: 'accepted' })

    const outbox = await prisma.mailOutboxMessage.findMany({
      where: { templateKind: 'password_recovery' },
    })
    expect(outbox).toHaveLength(1)
    expect(outbox[0].recipient).toBe('Email-link-recovery@mail.ru')
    expect(outbox[0].templatePayload).toEqual({
      expiresAt: expect.any(String),
      kind: 'password_recovery',
      recoveryUrl: 'https://app.example.test/recover/password',
    })
    const rawToken = derivePasswordResetToken(env.JWT_SECRET, outbox[0].messageId)
    expect(JSON.stringify(outbox[0].templatePayload)).not.toContain('email-link-recovery')
    expect(JSON.stringify(outbox[0])).not.toContain(rawToken)
    const credential = await prisma.passwordResetCredential.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { expiresAt: true, tokenHash: true },
    })
    expect(credential.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(credential.tokenHash).not.toContain(rawToken)
    expect(credential.expiresAt.getTime() - outbox[0].createdAt.getTime()).toBeLessThanOrEqual(
      15 * 60 * 1_000,
    )

    const budgets = await prisma.authAbuseBucket.findMany({
      where: { scope: { startsWith: 'password_reset_' } },
      select: { keyHash: true, scope: true },
    })
    expect(budgets).toHaveLength(20)
    expect(budgets.every((budget) => /^[a-f0-9]{64}$/.test(budget.keyHash))).toBe(true)
    const storedBudgets = JSON.stringify(budgets)
    expect(storedBudgets).not.toContain('email-link-recovery')
    expect(storedBudgets).not.toContain('198.51.100.103')
  })

  test('keeps exhausted password-reset login and IP budgets generic', async () => {
    const recoveryEnv = {
      ...env,
      CORS_ORIGINS: ['https://app.example.test'],
      WEBAPP_ORIGIN: 'https://app.example.test',
    }
    const recoveryApps = [createApp({
      env: {
        ...recoveryEnv,
      },
      prisma,
    }), createApp({ env: recoveryEnv, prisma })] as const
    const requestReset = (target: typeof app, login: string) => target.request(
      '/api/auth/password-recovery/request',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': '198.51.100.106',
        },
        body: JSON.stringify({ login }),
      },
    )

    const responses = []
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await requestReset(
        recoveryApps[attempt % recoveryApps.length],
        'budgeted-missing-link-recovery',
      ))
    }
    const loginBudgetRowsBefore = await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'password_reset_login_' } },
    })
    const afterIpExhaustion = await Promise.all(Array.from({ length: 12 }, (_, attempt) =>
      requestReset(
        recoveryApps[attempt % recoveryApps.length],
        `budgeted-missing-link-${attempt}`,
      )))
    responses.push(...afterIpExhaustion)

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
      Array.from({ length: 23 }, () => ({ outcome: 'accepted' })),
    )
    expect(await prisma.passwordResetCredential.count()).toBe(0)
    expect(await prisma.mailOutboxMessage.count()).toBe(0)
    expect(await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'password_reset_ip_hour' },
      select: { count: true },
    })).toEqual({ count: 11 })
    expect(await prisma.authAbuseBucket.findFirstOrThrow({
      where: { count: 4, scope: 'password_reset_login_hour' },
      select: { count: true },
    })).toEqual({ count: 4 })
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'password_reset_login_' } },
    })).toBe(loginBudgetRowsBefore)
  })

  test('atomically limits password-reset mail across API instances and resets an expired window', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('concurrent-email-link-recovery')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'concurrent-email-link-recovery@mail.ru',
      providerValue: 'Concurrent-email-link-recovery@mail.ru',
      userId: account.user.id,
    })
    const recoveryEnv = {
      ...env,
      CORS_ORIGINS: ['https://app.example.test'],
      WEBAPP_ORIGIN: 'https://app.example.test',
    }
    const recoveryApps = [
      createApp({ env: recoveryEnv, prisma }),
      createApp({ env: recoveryEnv, prisma }),
    ] as const
    const request = (target: typeof app) => target.request('/api/auth/password-recovery/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.110',
      },
      body: JSON.stringify({ login: account.user.login }),
    })

    const concurrent = await Promise.all([
      request(recoveryApps[0]),
      request(recoveryApps[1]),
      request(recoveryApps[0]),
      request(recoveryApps[1]),
    ])
    expect(concurrent.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect(await Promise.all(concurrent.map((response) => response.json())))
      .toEqual(Array.from({ length: 4 }, () => ({ outcome: 'accepted' })))
    expect(await prisma.mailOutboxMessage.count({
      where: { templateKind: 'password_recovery' },
    })).toBe(3)

    await prisma.authAbuseBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { scope: 'password_reset_login_hour' },
    })
    const afterExpiry = await request(recoveryApps[1])
    expect(afterExpiry.status).toBe(200)
    expect(await afterExpiry.json()).toEqual({ outcome: 'accepted' })
    expect(await prisma.mailOutboxMessage.count({
      where: { templateKind: 'password_recovery' },
    })).toBe(4)
    expect(await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'password_reset_login_hour' },
      select: { count: true },
    })).toEqual({ count: 1 })
  })

  test('consumes one email reset link atomically and revokes every prior credential', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('complete-email-link-recovery')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'complete-email-link-recovery@mail.ru',
      providerValue: 'Complete-email-link-recovery@mail.ru',
      userId: account.user.id,
    })
    const authHeaders = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
    }
    const issued = await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    })
    expect(issued.status).toBe(200)
    const recoveryCode = (await issued.json()).recoveryCodes[0] as string
    const secondSession = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'complete-email-link-recovery',
        password: 'password123',
      }),
    })
    expect(secondSession.status).toBe(200)
    const secondAccount = await secondSession.json()
    const recoveryApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://app.example.test'],
        WEBAPP_ORIGIN: 'https://app.example.test',
      },
      prisma,
    })
    expect((await recoveryApp.request('/api/auth/password-recovery/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.104',
      },
      body: JSON.stringify({ login: 'complete-email-link-recovery' }),
    })).status).toBe(200)
    const firstRecoveryMessage = await prisma.mailOutboxMessage.findFirstOrThrow({
      where: { templateKind: 'password_recovery' },
    })
    const firstToken = derivePasswordResetToken(env.JWT_SECRET, firstRecoveryMessage.messageId)
    expect((await recoveryApp.request('/api/auth/password-recovery/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.105',
      },
      body: JSON.stringify({ login: 'complete-email-link-recovery' }),
    })).status).toBe(200)
    const currentCredential = await prisma.passwordResetCredential.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { messageId: true },
    })
    const recoveryMessage = await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: currentCredential.messageId },
    })
    const token = derivePasswordResetToken(env.JWT_SECRET, recoveryMessage.messageId)
    expect(token).not.toBe(firstToken)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { id: firstRecoveryMessage.id },
      select: { recipient: true, state: true, templatePayload: true },
    })).toEqual({ recipient: '[redacted]', state: 'terminal_failure', templatePayload: {} })

    const restartedApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://app.example.test'],
        WEBAPP_ORIGIN: 'https://app.example.test',
      },
      prisma,
    })
    const complete = (resetToken: string, newPassword: string) => restartedApp.request(
      '/api/auth/password-recovery/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, token: resetToken }),
      },
    )
    expect(await (await complete(firstToken, 'must-not-win123')).json()).toEqual({
      outcome: 'accepted',
    })

    const responses = await Promise.all([
      complete(token, 'new-password123'),
      complete(token, 'other-password123'),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const outcomes = await Promise.all(responses.map((response) => response.json()))
    expect(outcomes.map((body) => body.outcome).sort()).toEqual(['accepted', 'completed'])
    expect(await prisma.passwordResetCredential.count()).toBe(0)
    expect(await prisma.recoveryCode.count({ where: { userId: account.user.id } })).toBe(0)
    expect(await prisma.recoveryCodeSet.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { consumedAt: true },
    })).toEqual({ consumedAt: expect.any(Date) })
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: account.user.id },
    })).toBe(0)
    expect((await restartedApp.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    })).status).toBe(401)
    expect((await restartedApp.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${secondAccount.accessToken}` },
    })).status).toBe(401)

    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { id: recoveryMessage.id },
      select: { recipient: true, state: true, templatePayload: true },
    })).toEqual({ recipient: '[redacted]', state: 'terminal_failure', templatePayload: {} })
    const notification = await prisma.mailOutboxMessage.findFirstOrThrow({
      where: { templateKind: 'security_notification' },
    })
    expect(notification.templatePayload).toEqual({
      event: 'password_changed',
      kind: 'security_notification',
      occurredAt: expect.any(String),
    })
    expect(JSON.stringify(notification)).not.toContain(token)

    const winningPassword = outcomes[0].outcome === 'completed'
      ? 'new-password123'
      : 'other-password123'
    expect((await restartedApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'complete-email-link-recovery', password: winningPassword }),
    })).status).toBe(200)
    expect(await (await restartedApp.request('/api/auth/recovery-code/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'complete-email-link-recovery',
        newPassword: 'must-not-win123',
        recoveryCode,
      }),
    })).json()).toEqual({ outcome: 'accepted' })
    expect(await (await complete(token, 'must-not-replay123')).json()).toEqual({
      outcome: 'accepted',
    })
  })

  test('keeps an expired reset link and an invalid new password fail-closed', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('expired-email-link-recovery')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'expired-email-link-recovery@mail.ru',
      providerValue: 'Expired-email-link-recovery@mail.ru',
      userId: account.user.id,
    })
    const recoveryApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://app.example.test'],
        WEBAPP_ORIGIN: 'https://app.example.test',
      },
      prisma,
    })
    expect((await recoveryApp.request('/api/auth/password-recovery/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.107',
      },
      body: JSON.stringify({ login: 'expired-email-link-recovery' }),
    })).status).toBe(200)
    const credential = await prisma.passwordResetCredential.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    const token = derivePasswordResetToken(env.JWT_SECRET, credential.messageId)

    expect((await recoveryApp.request('/api/auth/password-recovery/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'short', token }),
    })).status).toBe(400)
    expect(await prisma.passwordResetCredential.count({
      where: { userId: account.user.id },
    })).toBe(1)

    await prisma.passwordResetCredential.update({
      where: { id: credential.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    })
    const expired = await recoveryApp.request('/api/auth/password-recovery/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'new-password123', token }),
    })
    expect(expired.status).toBe(200)
    expect(await expired.json()).toEqual({ outcome: 'accepted' })
    expect(await prisma.passwordResetCredential.count({
      where: { userId: account.user.id },
    })).toBe(0)
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: account.user.id },
    })).toBe(1)
    expect(await prisma.mailOutboxMessage.count({
      where: { templateKind: 'security_notification' },
    })).toBe(0)
    expect((await recoveryApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'expired-email-link-recovery', password: 'password123' }),
    })).status).toBe(200)
  })

  test('rolls back password-reset request state when its mail cannot enter the outbox', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('password-reset-request-rollback')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'password-reset-request-rollback@mail.ru',
      providerValue: 'Password-reset-request-rollback@mail.ru',
      userId: account.user.id,
    })
    const messageId = '019f80a0-195d-7e23-9190-f690eb2e1c97'
    await prisma.$transaction(async (tx) => {
      await createTransactionalMailRequester(tx, env.JWT_SECRET).enqueue({
        messageId,
        recipient: 'occupied@mail.ru',
        template: {
          expiresAt: new Date(Date.now() + 15 * 60_000),
          kind: 'account_email_confirmation',
        },
      })
    })
    const repository = createPrismaAuthRepository(prisma, env.JWT_SECRET, {
      createMessageId: () => messageId,
    })
    const now = new Date()

    await expect(repository.requestPasswordReset({
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      ipAddress: '198.51.100.108',
      login: account.user.login,
      now,
      recoveryUrl: 'https://app.example.test/recover/password',
    })).rejects.toMatchObject({ kind: 'message_conflict' })

    expect(await prisma.passwordResetCredential.count()).toBe(0)
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'password_reset_' } },
    })).toBe(0)
    expect(await prisma.mailOutboxMessage.count()).toBe(1)
  })

  test('rolls back password change and credential revocation when notification enqueue fails', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('password-reset-completion-rollback')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'password-reset-completion-rollback@mail.ru',
      providerValue: 'Password-reset-completion-rollback@mail.ru',
      userId: account.user.id,
    })
    const issued = await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(issued.status).toBe(200)
    const resetMessageId = '019f80a0-b1f1-7e67-933b-e930daac59cb'
    const conflictingNotificationId = '019f80a0-d4ac-789e-81d0-109740de05af'
    await prisma.$transaction(async (tx) => {
      await createTransactionalMailRequester(tx, env.JWT_SECRET).enqueue({
        messageId: conflictingNotificationId,
        recipient: 'occupied@mail.ru',
        template: {
          expiresAt: new Date(Date.now() + 15 * 60_000),
          kind: 'account_email_confirmation',
        },
      })
    })
    const messageIds = [resetMessageId, conflictingNotificationId]
    const repository = createPrismaAuthRepository(prisma, env.JWT_SECRET, {
      createMessageId: () => messageIds.shift() ?? crypto.randomUUID(),
    })
    const now = new Date()
    await repository.requestPasswordReset({
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      ipAddress: '198.51.100.109',
      login: account.user.login,
      now,
      recoveryUrl: 'https://app.example.test/recover/password',
    })
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: account.user.id },
      select: { passwordHash: true },
    })
    const token = derivePasswordResetToken(env.JWT_SECRET, resetMessageId)

    await expect(repository.completePasswordReset({
      newPasswordHash: 'replacement-password-hash',
      now: new Date(now.getTime() + 1_000),
      token,
    })).rejects.toMatchObject({ kind: 'message_conflict' })

    expect(await prisma.user.findUniqueOrThrow({
      where: { id: account.user.id },
      select: { passwordHash: true },
    })).toEqual(before)
    expect(await prisma.passwordResetCredential.count({
      where: { userId: account.user.id },
    })).toBe(1)
    expect(await prisma.recoveryCode.count({ where: { userId: account.user.id } })).toBe(8)
    expect(await prisma.recoveryCodeSet.findUniqueOrThrow({
      where: { userId: account.user.id },
      select: { consumedAt: true },
    })).toEqual({ consumedAt: null })
    expect(await prisma.authSession.count({
      where: { revokedAt: null, userId: account.user.id },
    })).toBe(1)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: resetMessageId },
      select: { recipient: true, state: true },
    })).toEqual({ recipient: 'Password-reset-completion-rollback@mail.ru', state: 'queued' })
    expect(await prisma.mailOutboxMessage.count()).toBe(2)
  })

  test('rolls back Recovery Code consumption when its replacement mail cannot enter the outbox', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const user = await prisma.user.create({
      data: { login: 'recovery-code-outbox-rollback', passwordHash: 'stored-password-hash' },
    })
    const session = await prisma.authSession.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        refreshTokenFamilyHash: 'recovery-code-rollback-family',
        refreshTokenHash: 'recovery-code-rollback-refresh',
        userId: user.id,
      },
    })
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'recovery-code-old@mail.ru',
      providerValue: 'Recovery-code-old@mail.ru',
      userId: user.id,
    })
    const messageId = '019f8099-7e26-7760-ad08-66d1d66b2893'
    await prisma.$transaction(async (tx) => {
      await createTransactionalMailRequester(tx, env.JWT_SECRET).enqueue({
        messageId,
        recipient: 'occupied@mail.ru',
        template: {
          expiresAt: new Date(Date.now() + 15 * 60_000),
          kind: 'account_email_confirmation',
        },
      })
    })
    const repository = createPrismaAuthRepository(prisma, env.JWT_SECRET, {
      createMessageId: () => messageId,
    })
    const recoveryCodes = Array.from(
      { length: 8 },
      (_, index) => Array(8).fill(index.toString(16).toUpperCase().repeat(4)).join('-'),
    )
    expect(await repository.issueRecoveryCodes({
      codes: recoveryCodes,
      now: new Date(),
      userId: user.id,
    })).toBe('issued')

    await expect(repository.startRecoveryEmailWithRecoveryCode({
      expiresAt: new Date(Date.now() + 15 * 60_000),
      ipAddress: '198.51.100.95',
      login: user.login,
      newCanonicalKey: 'recovery-code-next@mail.ru',
      newProviderValue: 'Recovery-code-next@mail.ru',
      now: new Date(),
      recoveryCode: recoveryCodes[0],
    })).rejects.toMatchObject({ kind: 'message_conflict' })

    expect(await prisma.recoveryCode.count({ where: { userId: user.id } })).toBe(8)
    expect(await prisma.recoveryCodeSet.findUniqueOrThrow({
      where: { userId: user.id },
      select: { consumedAt: true },
    })).toEqual({ consumedAt: null })
    expect(await prisma.authSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { revokedAt: true },
    })).toEqual({ revokedAt: null })
    expect(await prisma.recoveryCodeEmailReplacement.count()).toBe(0)
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { startsWith: 'rec_code_' } },
    })).toBe(0)
    expect(await prisma.mailOutboxMessage.count()).toBe(1)
  })

  test('deletes recovery credentials and redacts their queued mail with the account', async () => {
    await seedApprovedMailService(prisma, 'mail.ru')
    const account = await registerTokenAccount('delete-recovery-codes')
    await seedActiveRecoveryEmail(prisma, {
      canonicalKey: 'delete-recovery-codes@mail.ru',
      providerValue: 'Delete-recovery-codes@mail.ru',
      userId: account.user.id,
    })
    const headers = {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      'x-test-client-ip': '198.51.100.96',
    }
    expect((await app.request('/api/auth/account-protection/recovery-codes/issue', {
      method: 'POST', headers, body: '{}',
    })).status).toBe(200)
    expect((await app.request('/api/auth/account-protection/recovery-codes/reissue/start', {
      method: 'POST', headers, body: JSON.stringify({ password: 'password123' }),
    })).status).toBe(200)
    const reissue = await prisma.recoveryCodeReissueChallenge.findUniqueOrThrow({
      where: { userId: account.user.id },
    })
    expect((await app.request('/api/auth/password-recovery/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.97',
      },
      body: JSON.stringify({ login: account.user.login }),
    })).status).toBe(200)
    const passwordReset = await prisma.passwordResetCredential.findUniqueOrThrow({
      where: { userId: account.user.id },
    })

    expect((await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${account.accessToken}` },
    })).status).toBe(204)
    expect(await prisma.recoveryCode.count({ where: { userId: account.user.id } })).toBe(0)
    expect(await prisma.recoveryCodeSet.count({ where: { userId: account.user.id } })).toBe(0)
    expect(await prisma.recoveryCodeReissueChallenge.count({
      where: { userId: account.user.id },
    })).toBe(0)
    expect(await prisma.passwordResetCredential.count({
      where: { userId: account.user.id },
    })).toBe(0)
    for (const messageId of [reissue.messageId, passwordReset.messageId]) {
      expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
        where: { messageId },
        select: { lastFailureCode: true, recipient: true, state: true, templatePayload: true },
      })).toEqual({
        lastFailureCode: 'owner_operation_cancelled',
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      })
    }
  })

  test('issues a short-lived realtime ticket for an authenticated session', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'ticket',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()

    const ticket = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    expect(ticket.status).toBe(201)
    expect(await ticket.json()).toMatchObject({
      expiresAt: expect.any(String),
      ticket: expect.any(String),
    })
  })

  test('durably limits realtime ticket issuance for one authenticated user', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'ticket-budget',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()
    const issueTicket = () => app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await issueTicket()).status).toBe(201)
    }

    const limited = await issueTicket()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many realtime ticket requests',
      },
    })
    expect(securityEvents).toContainEqual(expect.objectContaining({
      code: 'RATE_LIMITED',
      outcome: 'limited',
      reason: 'realtime_ticket_issue_budget',
      type: 'request_rejected',
    }))

    const secondSession = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'ticket-budget',
        password: 'password123',
      }),
    })
    const secondSessionBody = await secondSession.json()
    const limitedAcrossSessions = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secondSessionBody.accessToken}` },
    })
    expect(secondSession.status).toBe(200)
    expect(limitedAcrossSessions.status).toBe(429)
  })

  test('shares the room join budget across API instances', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'shared-room-join-budget',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()
    const secondApp = createApp({
      env,
      prisma,
      securityEvents: {
        emit: (event) => {
          securityEvents.push(event)
        },
      },
    })
    const joinUnknownRoom = (targetApp: typeof app) => targetApp.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'ABCDEFGHJK' }),
    })

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await joinUnknownRoom(attempt % 2 === 0 ? app : secondApp)
      expect(response.status).toBe(404)
    }

    const limited = await joinUnknownRoom(app)
    expect(limited.status).toBe(429)
    const roomRetryAfter = Number(limited.headers.get('retry-after'))
    expect(roomRetryAfter).toBeGreaterThan(0)
    expect(roomRetryAfter).toBeLessThanOrEqual(60)
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many room join attempts',
      },
    })
    expect(securityEvents).toContainEqual(expect.objectContaining({
      code: 'RATE_LIMITED',
      outcome: 'limited',
      reason: 'room_join_budget',
      type: 'request_rejected',
    }))

    const otherRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'independent-room-join-budget',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const other = await otherRegister.json()
    expect((await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'ABCDEFGHJK' }),
    })).status).toBe(404)

    await prisma.authAbuseBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { scope: 'room_join' },
    })
    expect((await joinUnknownRoom(app)).status).toBe(404)
  })

  test('atomically limits concurrent room joins across API instances', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'concurrent-room-join-budget',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()
    const secondApp = createApp({
      env,
      prisma,
      securityEvents: { emit: (event) => securityEvents.push(event) },
    })

    const responses = await Promise.all(Array.from({ length: 21 }, (_, index) =>
      (index % 2 === 0 ? app : secondApp).request('/api/rooms/join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: 'ABCDEFGHJK' }),
      })))

    expect(responses.map((response) => response.status).sort((left, right) => left - right))
      .toEqual([...Array.from({ length: 20 }, () => 404), 429])
  })

  test('shares a Tender command budget per player and Tender across API instances', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      expect(response.status).toBe(201)
      return response.json()
    }
    const player = await register('shared-tender-command-budget')
    const opponent = await register('shared-tender-command-opponent')
    const malformedTenderCommand = await app.request('/api/tenders/not-a-uuid/commands', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'malformed-resource-budget-command',
        slot: 3,
        tenderId: 'not-a-uuid',
        type: 'request-access-slot',
      }),
    })
    expect(malformedTenderCommand.status).toBe(400)
    expect(await prisma.authAbuseBucket.count({ where: { scope: 'tender_command' } })).toBe(0)
    const { tenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { displayName: 'Игрок', id: player.user.id, tiePriority: 1 },
        { displayName: 'Оппонент', id: opponent.user.id, tiePriority: 2 },
      ],
    })
    const unauthenticatedCommand = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'unauthenticated-budget-command',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(unauthenticatedCommand.status).toBe(401)
    expect(await prisma.authAbuseBucket.count({ where: { scope: 'tender_command' } })).toBe(0)
    const secondApp = createApp({
      env,
      prisma,
      securityEvents: { emit: (event) => securityEvents.push(event) },
    })
    const submitCommand = (targetApp: typeof app, command: Record<string, unknown>) => targetApp.request(
      `/api/tenders/${tenderId}/commands`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${player.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      },
    )
    const acceptedCommand = {
      actorId: player.user.id,
      commandId: 'shared-budget-command',
      slot: 3,
      tenderId,
      type: 'request-access-slot',
    }
    expect((await submitCommand(app, acceptedCommand)).status).toBe(200)

    for (let attempt = 1; attempt <= 58; attempt += 1) {
      const response = await submitCommand(attempt % 2 === 0 ? app : secondApp, {
        actorId: player.user.id,
        commandId: `shared-budget-working-model-${attempt}`,
        tenderId,
        type: 'update-working-model',
        workingModel: { signals: { aster: { note: `Budget probe ${attempt}` } } },
      })
      expect(response.status).toBe(200)
    }

    const boundary = await Promise.all([
      submitCommand(app, {
        actorId: player.user.id,
        commandId: 'shared-budget-boundary-a',
        tenderId,
        type: 'update-working-model',
        workingModel: { signals: { aster: { note: 'Boundary A' } } },
      }),
      submitCommand(secondApp, {
        actorId: player.user.id,
        commandId: 'shared-budget-boundary-b',
        tenderId,
        type: 'update-working-model',
        workingModel: { signals: { aster: { note: 'Boundary B' } } },
      }),
    ])
    expect(boundary.map((response) => response.status).sort()).toEqual([200, 429])
    const limited = boundary.find((response) => response.status === 429)!
    expect(limited.status).toBe(429)
    const tenderRetryAfter = Number(limited.headers.get('retry-after'))
    expect(tenderRetryAfter).toBeGreaterThan(0)
    expect(tenderRetryAfter).toBeLessThanOrEqual(60)
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many Tender command requests',
      },
    })
    expect(securityEvents).toContainEqual(expect.objectContaining({
      code: 'RATE_LIMITED',
      outcome: 'limited',
      reason: 'tender_command_budget',
      type: 'request_rejected',
    }))
    expect(securityEvents.filter((event) => event.reason === 'tender_command_budget'))
      .toHaveLength(1)

    const replayed = await submitCommand(secondApp, acceptedCommand)
    expect(replayed.status).toBe(200)
    expect(await replayed.json()).toEqual({ tenderId, version: 1 })
    expect(securityEvents.filter((event) => event.reason === 'tender_command_budget'))
      .toHaveLength(1)

    await prisma.authAbuseBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
      where: { scope: 'tender_command' },
    })
    expect((await submitCommand(secondApp, {
      actorId: player.user.id,
      commandId: 'shared-budget-after-expiry',
      tenderId,
      type: 'update-working-model',
      workingModel: { signals: { aster: { note: 'After expiry' } } },
    })).status).toBe(200)

    const opponentCommand = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opponent.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: opponent.user.id,
        commandId: 'independent-player-budget-command',
        slot: 4,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(opponentCommand.status).toBe(200)

    const { tenderId: otherTenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { id: player.user.id, tiePriority: 1 },
        { id: opponent.user.id, tiePriority: 2 },
      ],
    })
    const otherTenderCommand = await app.request(`/api/tenders/${otherTenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'independent-tender-budget-command',
        slot: 3,
        tenderId: otherTenderId,
        type: 'request-access-slot',
      }),
    })
    expect(otherTenderCommand.status).toBe(200)
  })

  test('shares a safety budget for authenticated mutations across API instances', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'shared-authenticated-mutation-budget',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()
    const secondApp = createApp({ env, prisma })
    const updateProfile = (targetApp: typeof app) => targetApp.request('/api/auth/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'Исследователь' }),
    })

    for (let attempt = 1; attempt <= 120; attempt += 1) {
      const response = await updateProfile(attempt % 2 === 0 ? app : secondApp)
      expect(response.status).toBe(204)
    }

    const limited = await updateProfile(app)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authenticated mutation requests',
      },
    })
    expect(securityEvents).toContainEqual(expect.objectContaining({
      code: 'RATE_LIMITED',
      outcome: 'limited',
      reason: 'authenticated_mutation_budget',
      type: 'request_rejected',
    }))

    const limitedRoomMutation = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'ABCDEFGHJK' }),
    })
    expect(limitedRoomMutation.status).toBe(429)
    expect(await limitedRoomMutation.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authenticated mutation requests',
      },
    })
    expect(await prisma.authAbuseBucket.count({
      where: { scope: 'room_join' },
    })).toBe(0)

    const player = await prisma.user.findUniqueOrThrow({
      where: { login: 'shared-authenticated-mutation-budget' },
    })
    const opponent = await prisma.user.create({
      data: { login: 'shared-mutation-opponent', passwordHash: 'hash' },
    })
    const { tenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { id: player.id, tiePriority: 1 },
        { id: opponent.id, tiePriority: 2 },
      ],
    })
    const limitedTenderMutation = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.id,
        commandId: 'general-budget-command',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(limitedTenderMutation.status).toBe(429)
    expect(await limitedTenderMutation.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authenticated mutation requests',
      },
    })
    expect(await prisma.authAbuseBucket.count({
      where: { scope: 'tender_command' },
    })).toBe(0)

    const limitedRealtimeMutation = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(limitedRealtimeMutation.status).toBe(429)
    expect(await limitedRealtimeMutation.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authenticated mutation requests',
      },
    })
    expect(await prisma.authAbuseBucket.count({
      where: { scope: 'realtime_ticket_issue' },
    })).toBe(0)

    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const currentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const health = await app.request('/health/ready')
    expect(me.status).toBe(200)
    expect(currentRoom.status).toBe(200)
    expect(health.status).toBe(200)
  })

  test('creates a private room and lets another authenticated player join it', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'room-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken, user } = await register.json()

    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })

    expect(createRoom.status).toBe(201)
    const room = await createRoom.json()
    expect(room).toEqual({
      capacity: 2,
      hostId: user.id,
      joinCode: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{10}$/),
      roomId: expect.any(String),
      members: [{ displayName: user.displayName ?? 'Исследователь', ready: false, seat: 1, userId: user.id }],
      serverTime: expect.any(String),
      status: 'waiting',
    })

    const joinerRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'room-joiner',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const joiner = await joinerRegister.json()
    const join = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: ` ${room.joinCode.toLowerCase()} ` }),
    })

    expect(join.status).toBe(200)
    expect(await join.json()).toMatchObject({
      members: [
        { ready: false, seat: 1, userId: user.id },
        { ready: false, seat: 2, userId: joiner.user.id },
      ],
      roomId: room.roomId,
    })

    const readRoom = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(readRoom.status).toBe(200)
    expect(await readRoom.json()).toMatchObject({
      members: [
        { userId: user.id },
        { userId: joiner.user.id },
      ],
      roomId: room.roomId,
    })

    const extraRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'room-extra',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const extra = await extraRegister.json()
    const expectRoomHiddenFromExtra = async () => {
      const existingRoom = await app.request(`/api/rooms/${room.roomId}`, {
        headers: { Authorization: `Bearer ${extra.accessToken}` },
      })
      const absentRoom = await app.request('/api/rooms/019f8099-7e26-7760-ad08-66d1d66b2719', {
        headers: { Authorization: `Bearer ${extra.accessToken}` },
      })

      expect(existingRoom.status).toBe(404)
      expect(await existingRoom.json()).toEqual(await absentRoom.json())
    }
    await expectRoomHiddenFromExtra()

    const fullRoomJoin = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${extra.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })

    expect(fullRoomJoin.status).toBe(409)
    expect(await fullRoomJoin.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    const leave = await app.request(`/api/rooms/${room.roomId}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(leave.status).toBe(204)

    const rejoin = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })
    expect(rejoin.status).toBe(200)
    expect(await rejoin.json()).toMatchObject({
      members: [{ seat: 1, userId: user.id }, { seat: 2, userId: joiner.user.id }],
      roomId: room.roomId,
    })

    const nonHostStart = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(nonHostStart.status).toBe(404)

    const unreadyStart = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(unreadyStart.status).toBe(409)

    const hostReady = await app.request(`/api/rooms/${room.roomId}/ready`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ready: true }),
    })
    expect(hostReady.status).toBe(200)
    expect(await hostReady.json()).toMatchObject({
      members: [
        { ready: true, userId: user.id },
        { ready: false, userId: joiner.user.id },
      ],
    })

    const joinerReady = await app.request(`/api/rooms/${room.roomId}/ready`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ready: true }),
    })
    expect(joinerReady.status).toBe(200)
    expect(await joinerReady.json()).toMatchObject({
      members: [
        { ready: true, userId: user.id },
        { ready: true, userId: joiner.user.id },
      ],
    })

    const start = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(start.status).toBe(200)
    const scheduledRoom = await start.json()
    expect(scheduledRoom).toMatchObject({
      roomId: room.roomId,
      serverTime: expect.any(String),
      status: 'starting',
      startsAt: expect.any(String),
    })
    expect(scheduledRoom.tenderId).toBeUndefined()
    const startingRoomForMember = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(startingRoomForMember.status).toBe(200)
    expect(await startingRoomForMember.json()).toMatchObject({ status: 'starting' })
    await expectRoomHiddenFromExtra()

    const cancelStart = await app.request(`/api/rooms/${room.roomId}/cancel-start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(cancelStart.status).toBe(200)
    const cancelledRoom = await cancelStart.json()
    expect(cancelledRoom.roomId).toBe(room.roomId)
    expect(cancelledRoom.status).toBe('waiting')
    expect('startsAt' in cancelledRoom).toBe(false)

    const restart = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(restart.status).toBe(200)
    const restartedRoom = await restart.json()

    await createRoomStartModule(prisma).advanceDueRoomStarts({ now: new Date(restartedRoom.startsAt) })
    const startedRoomResponse = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(startedRoomResponse.status).toBe(200)
    const startedRoom = await startedRoomResponse.json()
    expect(startedRoom.roomId).toBe(room.roomId)
    expect(startedRoom.status).toBe('started')
    expect(startedRoom.tenderId).toBeString()
    await expectRoomHiddenFromExtra()
    const tenderId = startedRoom.tenderId as string
    expect(await prisma.tender.findUnique({ where: { id: tenderId } })).not.toBeNull()

    const playerView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(playerView.status).toBe(200)
    expect(await playerView.json()).toMatchObject({
      phase: 'access-slot-selection',
      serverTime: expect.any(String),
      tenderId,
    })

    const outsiderView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${extra.accessToken}` },
    })
    const absentView = await app.request('/api/tenders/00000000-0000-4000-8000-000000000000', {
      headers: { Authorization: `Bearer ${extra.accessToken}` },
    })
    expect(outsiderView.status).toBe(404)
    expect(absentView.status).toBe(404)
    expect(await outsiderView.json()).toEqual(await absentView.json())

    const command = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: user.id,
        commandId: 'access-slot-host-1',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(command.status).toBe(200)
    expect(await command.json()).toEqual({ tenderId, version: 1 })

    const workingModelCommand = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: user.id,
        commandId: 'working-model-host-1',
        tenderId,
        type: 'update-working-model',
        workingModel: {
          signals: {
            aster: { note: 'Host-only hypothesis' },
          },
        },
      }),
    })
    expect(workingModelCommand.status).toBe(200)

    const hostPrivateView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const joinerPrivateView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${joiner.accessToken}` },
    })
    expect(hostPrivateView.status).toBe(200)
    expect(joinerPrivateView.status).toBe(200)
    expect(await hostPrivateView.json()).toMatchObject({
      players: expect.arrayContaining([
        expect.objectContaining({ playerId: user.id, requestedAccessSlot: 3 }),
      ]),
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateResearchCertifications: [],
      privateSamples: [],
      privateUsedContractEvidenceTestIds: [],
      privateWorkingModel: {
        signals: {
          aster: { note: 'Host-only hypothesis' },
        },
      },
    })
    const joinerPrivateBody = await joinerPrivateView.json()
    expect(joinerPrivateBody).toMatchObject({
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateResearchCertifications: [],
      privateSamples: [],
      privateUsedContractEvidenceTestIds: [],
      privateWorkingModel: { signals: {} },
    })
    expect(joinerPrivateBody.players.find((player: { playerId: string }) => player.playerId === user.id))
      .not.toHaveProperty('requestedAccessSlot')
  }, 10_000)

  test('does not expose or mutate a Tender when an outsider submits a command by id', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      expect(response.status).toBe(201)
      return response.json()
    }
    const player = await register('tender-command-idor-player')
    const secondPlayer = await register('tender-command-idor-second-player')
    const outsider = await register('tender-command-idor-outsider')
    const { tenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { id: player.user.id, tiePriority: 1 },
        { id: secondPlayer.user.id, tiePriority: 2 },
      ],
    })
    const acceptedParticipantCommand = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'shared-access-slot-command',
        slot: 2,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(acceptedParticipantCommand.status).toBe(200)
    const absentTenderId = '00000000-0000-4000-8000-000000000000'
    const submitCommand = (targetTenderId: string) => app.request(
      `/api/tenders/${targetTenderId}/commands`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${outsider.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actorId: outsider.user.id,
          commandId: 'shared-access-slot-command',
          slot: 1,
          tenderId: targetTenderId,
          type: 'request-access-slot',
        }),
      },
    )

    const existingTenderCommand = await submitCommand(tenderId)
    const absentTenderCommand = await submitCommand(absentTenderId)

    expect(existingTenderCommand.status).toBe(404)
    expect(absentTenderCommand.status).toBe(404)
    expect(await existingTenderCommand.json()).toEqual(await absentTenderCommand.json())
    expect(await prisma.authAbuseBucket.count({
      where: { scope: 'tender_command' },
    })).toBe(1)

    const participantCommandIdCollision = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondPlayer.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: secondPlayer.user.id,
        commandId: 'shared-access-slot-command',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(participantCommandIdCollision.status).toBe(409)

    const pathBodyMismatch = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'path-body-mismatch',
        slot: 3,
        tenderId: absentTenderId,
        type: 'request-access-slot',
      }),
    })
    expect(pathBodyMismatch.status).toBe(403)

    const actorImpersonation = await app.request(`/api/tenders/${tenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondPlayer.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'actor-impersonation',
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
    })
    expect(actorImpersonation.status).toBe(403)

    const { tenderId: secondTenderId } = await createPersistentTenderModule(prisma).createTender({
      players: [
        { id: player.user.id, tiePriority: 1 },
        { id: secondPlayer.user.id, tiePriority: 2 },
      ],
    })
    const sameCommandIdInAnotherTender = await app.request(`/api/tenders/${secondTenderId}/commands`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${player.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        actorId: player.user.id,
        commandId: 'shared-access-slot-command',
        slot: 4,
        tenderId: secondTenderId,
        type: 'request-access-slot',
      }),
    })
    expect(sameCommandIdInAnotherTender.status).toBe(200)
    expect(await sameCommandIdInAnotherTender.json()).toEqual({
      tenderId: secondTenderId,
      version: 1,
    })

    const participantView = await app.request(`/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    })
    expect(participantView.status).toBe(200)
    const participantBody = await participantView.json()
    expect(participantBody.version).toBe(1)
    expect(participantBody.players.find((candidate: { playerId: string }) =>
      candidate.playerId === player.user.id)).toMatchObject({ requestedAccessSlot: 2 })
    expect(participantBody.players.some((candidate: { playerId: string }) =>
      candidate.playerId === outsider.user.id)).toBe(false)
  })

  test('rejects a malformed Tender id before querying PostgreSQL', async () => {
    const player = await registerForMeGuard('malformed-tender-id')
    const response = await app.request('/api/tenders/not-a-uuid', {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    })
  })

  test('exposes one current room and blocks creating another until the player leaves', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'single-current-room',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    const firstRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacity: 2 }),
    })
    expect(firstRoom.status).toBe(201)
    const created = await firstRoom.json()

    const currentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(currentRoom.status).toBe(200)
    expect(await currentRoom.json()).toMatchObject({
      match: {
        roomId: created.roomId,
        status: 'waiting',
      },
    })

    const blockedRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacity: 2 }),
    })
    expect(blockedRoom.status).toBe(409)
    expect(await blockedRoom.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    const otherRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'single-current-other-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const other = await otherRegister.json()
    const otherRoomResponse = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const otherRoom = await otherRoomResponse.json()
    const blockedJoin = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: otherRoom.joinCode }),
    })
    expect(blockedJoin.status).toBe(409)
    expect(await blockedJoin.json()).toMatchObject({ error: { code: 'CONFLICT' } })

    const leave = await app.request(`/api/rooms/${created.roomId}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(leave.status).toBe(204)

    const noCurrentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(noCurrentRoom.status).toBe(200)
    expect(await noCurrentRoom.json()).toEqual({ match: null })

    const replacementRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacity: 2 }),
    })
    expect(replacementRoom.status).toBe(201)
  })

  test('does not expose direct room joining by guessed room id', async () => {
    const hostRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'direct-join-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const host = await hostRegister.json()
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()

    const outsiderRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'direct-join-outsider',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const outsider = await outsiderRegister.json()
    const guessedRoomJoin = await app.request(`/api/rooms/${room.roomId}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${outsider.accessToken}` },
    })

    expect(guessedRoomJoin.status).toBe(404)
  })

  test('does not let an outsider leave or discover a room by guessed room id', async () => {
    const hostRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-idor-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const host = await hostRegister.json()
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()

    const outsiderRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-idor-outsider',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const outsider = await outsiderRegister.json()
    const authorization = { Authorization: `Bearer ${outsider.accessToken}` }
    const existingRoomLeave = await app.request(`/api/rooms/${room.roomId}/leave`, {
      method: 'POST',
      headers: authorization,
    })
    const absentRoomLeave = await app.request('/api/rooms/019f8099-7e26-7760-ad08-66d1d66b2719/leave', {
      method: 'POST',
      headers: authorization,
    })

    expect(existingRoomLeave.status).toBe(404)
    expect(absentRoomLeave.status).toBe(404)
    expect(await existingRoomLeave.json()).toEqual(await absentRoomLeave.json())
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.roomId },
      select: {
        hostId: true,
        members: { select: { userId: true } },
        currentMatches: { select: { userId: true } },
      },
    })).toEqual({
      hostId: host.user.id,
      members: [{ userId: host.user.id }],
      currentMatches: [{ userId: host.user.id }],
    })
  })

  test('only lets room members change their own readiness without exposing room existence', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      return response.json()
    }
    const host = await register('ready-idor-host')
    const member = await register('ready-idor-member')
    const outsider = await register('ready-idor-outsider')
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()
    await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })

    const setReady = (accessToken: string, roomId: string, ready: boolean) => app.request(
      `/api/rooms/${roomId}/ready`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ready }),
      },
    )

    const memberReady = await setReady(member.accessToken, room.roomId, true)
    expect(memberReady.status).toBe(200)
    expect(await memberReady.json()).toMatchObject({
      members: [
        { ready: false, userId: host.user.id },
        { ready: true, userId: member.user.id },
      ],
    })
    const memberNotReady = await setReady(member.accessToken, room.roomId, false)
    expect(memberNotReady.status).toBe(200)
    expect(await memberNotReady.json()).toMatchObject({
      members: [
        { ready: false, userId: host.user.id },
        { ready: false, userId: member.user.id },
      ],
    })

    for (const ready of [true, false]) {
      const existingRoom = await setReady(outsider.accessToken, room.roomId, ready)
      const absentRoom = await setReady(
        outsider.accessToken,
        '019f8099-7e26-7760-ad08-66d1d66b2719',
        ready,
      )
      expect(existingRoom.status).toBe(404)
      expect(await existingRoom.json()).toEqual(await absentRoom.json())
    }
    expect(await prisma.tenderRoomMember.findMany({
      where: { roomId: room.roomId },
      orderBy: { seat: 'asc' },
      select: { ready: true, userId: true },
    })).toEqual([
      { ready: false, userId: host.user.id },
      { ready: false, userId: member.user.id },
    ])

    const concurrentReady = await Promise.all([
      setReady(host.accessToken, room.roomId, true),
      setReady(member.accessToken, room.roomId, true),
    ])
    expect(concurrentReady.map((response) => response.status)).toEqual([200, 200])
    const startRoom = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(startRoom.status).toBe(200)

    const memberAfterStart = await setReady(member.accessToken, room.roomId, false)
    expect(memberAfterStart.status).toBe(409)
    const outsiderAfterStart = await setReady(outsider.accessToken, room.roomId, false)
    const absentAfterStart = await setReady(
      outsider.accessToken,
      '019f8099-7e26-7760-ad08-66d1d66b2719',
      false,
    )
    expect(outsiderAfterStart.status).toBe(404)
    expect(await outsiderAfterStart.json()).toEqual(await absentAfterStart.json())
  })

  test('only lets the path room host schedule its start without exposing other rooms', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      return response.json()
    }
    const firstHost = await register('start-idor-first-host')
    const secondHost = await register('start-idor-second-host')
    const secondMember = await register('start-idor-second-member')
    const outsider = await register('start-idor-outsider')
    const createRoom = async (accessToken: string) => {
      const response = await app.request('/api/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capacity: 2 }),
      })
      return response.json()
    }
    const firstRoom = await createRoom(firstHost.accessToken)
    const secondRoom = await createRoom(secondHost.accessToken)
    await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secondMember.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: secondRoom.joinCode }),
    })
    const startRoom = (accessToken: string, roomId: string) => app.request(
      `/api/rooms/${roomId}/start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    const absentRoomId = '019f8099-7e26-7760-ad08-66d1d66b2719'
    const tenderCountBefore = await prisma.tender.count()

    for (const [accessToken, foreignRoomId] of [
      [firstHost.accessToken, secondRoom.roomId],
      [secondMember.accessToken, firstRoom.roomId],
      [outsider.accessToken, secondRoom.roomId],
    ] as const) {
      const existingForeignRoom = await startRoom(accessToken, foreignRoomId)
      const absentRoom = await startRoom(accessToken, absentRoomId)

      expect(existingForeignRoom.status).toBe(404)
      expect(await existingForeignRoom.json()).toEqual(await absentRoom.json())
    }
    expect(await prisma.tenderRoom.findMany({
      where: { id: { in: [firstRoom.roomId, secondRoom.roomId] } },
      orderBy: { id: 'asc' },
      select: { id: true, startsAt: true, status: true, tenderId: true },
    })).toEqual([
      { id: firstRoom.roomId, startsAt: null, status: 'waiting', tenderId: null },
      { id: secondRoom.roomId, startsAt: null, status: 'waiting', tenderId: null },
    ].sort((left, right) => left.id.localeCompare(right.id)))
    expect(await prisma.tender.count()).toBe(tenderCountBefore)
  })

  test('only lets the target room host cancel its start without exposing other rooms', async () => {
    const register = async (login: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      return response.json()
    }
    const host = await register('cancel-start-idor-host')
    const member = await register('cancel-start-idor-member')
    const otherHost = await register('cancel-start-idor-other-host')
    const outsider = await register('cancel-start-idor-outsider')
    const createRoom = async (accessToken: string) => {
      const response = await app.request('/api/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capacity: 2 }),
      })
      return response.json()
    }
    const room = await createRoom(host.accessToken)
    await createRoom(otherHost.accessToken)
    await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })
    const setReady = (accessToken: string) => app.request(`/api/rooms/${room.roomId}/ready`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ready: true }),
    })
    expect((await setReady(host.accessToken)).status).toBe(200)
    expect((await setReady(member.accessToken)).status).toBe(200)
    const start = await app.request(`/api/rooms/${room.roomId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(start.status).toBe(200)
    const scheduledRoom = await start.json()
    const cancelStart = (accessToken: string, roomId: string) => app.request(
      `/api/rooms/${roomId}/cancel-start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    const absentRoomId = '019f8099-7e26-7760-ad08-66d1d66b2719'
    const tenderCountBefore = await prisma.tender.count()

    for (const accessToken of [
      member.accessToken,
      otherHost.accessToken,
      outsider.accessToken,
    ] as const) {
      const existingForeignRoom = await cancelStart(accessToken, room.roomId)
      const absentRoom = await cancelStart(accessToken, absentRoomId)

      expect(existingForeignRoom.status).toBe(404)
      expect(await existingForeignRoom.json()).toEqual(await absentRoom.json())
    }
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.roomId },
      select: { startsAt: true, status: true, tenderId: true },
    })).toEqual({
      startsAt: new Date(scheduledRoom.startsAt),
      status: 'starting',
      tenderId: null,
    })
    expect(await prisma.tender.count()).toBe(tenderCountBefore)

    const legitimateCancel = await cancelStart(host.accessToken, room.roomId)
    expect(legitimateCancel.status).toBe(200)
    expect(await legitimateCancel.json()).toMatchObject({
      roomId: room.roomId,
      status: 'waiting',
    })
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.roomId },
      select: { startsAt: true, status: true, tenderId: true },
    })).toEqual({
      startsAt: null,
      status: 'waiting',
      tenderId: null,
    })
    expect(await prisma.tender.count()).toBe(tenderCountBefore)
  })

  test('transfers a waiting room to the remaining member when its host leaves', async () => {
    const hostRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-host-transfer-host',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const host = await hostRegister.json()
    const memberRegister = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'leave-host-transfer-member',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const member = await memberRegister.json()
    const createRoom = await app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })
    const room = await createRoom.json()
    const joinRoom = await app.request('/api/rooms/join', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${member.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: room.joinCode }),
    })
    expect(joinRoom.status).toBe(200)

    const leave = await app.request(`/api/rooms/${room.roomId}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(leave.status).toBe(204)

    const roomForMember = await app.request(`/api/rooms/${room.roomId}`, {
      headers: { Authorization: `Bearer ${member.accessToken}` },
    })
    expect(roomForMember.status).toBe(200)
    expect(await roomForMember.json()).toMatchObject({
      hostId: member.user.id,
      members: [{ ready: false, userId: member.user.id }],
      status: 'waiting',
    })
    const formerHostCurrentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${host.accessToken}` },
    })
    expect(formerHostCurrentRoom.status).toBe(200)
    expect(await formerHostCurrentRoom.json()).toEqual({ match: null })
  })

  test('creates only one current room across concurrent requests from one player', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'concurrent-current-room',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const { accessToken } = await register.json()
    const request = () => app.request('/api/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capacity: 2 }),
    })

    const responses = await Promise.all([request(), request()])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const currentRoom = await app.request('/api/rooms/current', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(currentRoom.status).toBe(200)
    expect((await currentRoom.json()).match.roomId).toBeString()
  })

  test('returns one durable successor across three concurrent refresh requests', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        login: 'race',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const registerBody = await register.json()

    const refreshRequests = await Promise.all([
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
      app.request('/api/auth/token/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: registerBody.refreshToken }),
      }),
    ])

    const statuses = refreshRequests.map((response) => response.status)
    expect(statuses).toEqual([200, 200, 200])
    const refreshBodies = await Promise.all(refreshRequests.map((response) => response.json()))
    const returnedRefreshTokens = refreshBodies.map((body) => body.refreshToken)
    expect(new Set(returnedRefreshTokens).size).toBe(1)

    const activeSessions = await prisma.authSession.count({
      where: {
        user: {
          login: 'race',
        },
        revokedAt: null,
      },
    })
    expect(activeSessions).toBe(1)

    const totalSessions = await prisma.authSession.count({
      where: {
        user: {
          login: 'race',
        },
      },
    })
    expect(totalSessions).toBe(1)

    await prisma.authSession.updateMany({
      where: { user: { login: 'race' } },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const delayedWinner = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: returnedRefreshTokens.at(-1) }),
    })
    expect(delayedWinner.status).toBe(200)
  })

  test('revokes a session when any older refresh credential is reused after grace', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'reuse',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const registered = await register.json()
    const refresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    const refreshed = await refresh.json()

    const refreshAgain = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshed.refreshToken }),
    })
    const refreshedAgain = await refreshAgain.json()
    expect(refreshAgain.status).toBe(200)

    await prisma.authSession.updateMany({
      where: { user: { login: 'reuse' } },
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    })

    const replay = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: registered.refreshToken }),
    })
    expect(replay.status).toBe(401)
    expect(securityEvents).toContainEqual(expect.objectContaining({
      code: 'UNAUTHORIZED',
      outcome: 'denied',
      reason: 'refresh_token_reused',
      type: 'authentication_rejected',
    }))

    const attackerCredential = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshedAgain.refreshToken }),
    })
    expect(attackerCredential.status).toBe(401)
  })

  test('web auth never exposes its HttpOnly refresh token when the client platform header is spoofed', async () => {
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({
        login: 'web-cookie',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('anomaly_detector_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    const refresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setCookie!.split(';')[0],
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify({}),
    })
    const refreshBody = await refresh.json()

    expect(refresh.status).toBe(200)
    expect(refreshBody.accessToken).toBeString()
    expect(refreshBody.refreshToken).toBeUndefined()
  })

  test('does not let cookie and explicit token transports borrow each other credentials', async () => {
    const refreshToken = 'r'.repeat(32)
    const cookieWithBodyToken = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    expect(cookieWithBodyToken.status).toBe(400)

    const tokenWithCookieOnly = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `anomaly_detector_refresh=${refreshToken}`,
      },
      body: JSON.stringify({}),
    })
    expect(tokenWithCookieOnly.status).toBe(400)
  })

  test('production web auth allows an exact same-site custom-domain origin', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        WEBAPP_ORIGIN: 'https://web.example.com',
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        login: 'production-cookie',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const registerBody = await register.json()
    const setCookie = register.headers.get('set-cookie')

    expect(register.status).toBe(201)
    expect(register.headers.get('access-control-allow-origin')).toBe('https://web.example.com')
    expect(register.headers.get('access-control-allow-credentials')).toBe('true')
    expect(registerBody.refreshToken).toBeUndefined()
    expect(setCookie).toContain('anomaly_detector_refresh=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=None')
  })

  test('production cookie auth rejects untrusted refresh and logout origins', async () => {
    const productionApp = createApp({
      env: {
        ...env,
        CORS_ORIGINS: ['https://web.example.com'],
        WEBAPP_ORIGIN: 'https://web.example.com',
        COOKIE_SECURE: true,
      },
      prisma,
    })
    const register = await productionApp.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        login: 'csrf-cookie',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const cookie = register.headers.get('set-cookie')!.split(';')[0]

    const noOriginRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({}),
    })
    const noOriginBody = await noOriginRefresh.json()
    expect(noOriginRefresh.status).toBe(403)
    expect(noOriginBody.error.code).toBe('FORBIDDEN')

    const untrustedLogout = await productionApp.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    })
    const untrustedLogoutBody = await untrustedLogout.json()
    expect(untrustedLogout.status).toBe(403)
    expect(untrustedLogoutBody.error.code).toBe('FORBIDDEN')

    const allowedRefresh = await productionApp.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({}),
    })
    expect(allowedRefresh.status).toBe(200)
  })

  test('guards me and returns stable validation errors', async () => {
    const unauthorizedMe = await app.request('/api/auth/me')
    expect(unauthorizedMe.status).toBe(401)

    const invalidRegister = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'not-an-login',
        password: 'short',
      }),
    })
    const body = await invalidRegister.json()

    expect(invalidRegister.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Invalid request payload')
    expect(Array.isArray(body.error.details)).toBe(true)
  })

  test('me rejects revoked, expired, and missing sessions', async () => {
    const revoked = await registerForMeGuard('me-revoked')
    await prisma.authSession.updateMany({
      where: {
        userId: revoked.userId,
      },
      data: {
        revokedAt: new Date(),
      },
    })
    const revokedMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${revoked.accessToken}`,
      },
    })
    expect(revokedMe.status).toBe(401)

    const expired = await registerForMeGuard('me-expired')
    await prisma.authSession.updateMany({
      where: {
        userId: expired.userId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    const expiredMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${expired.accessToken}`,
      },
    })
    expect(expiredMe.status).toBe(401)

    const missing = await registerForMeGuard('me-missing')
    await prisma.authSession.deleteMany({
      where: {
        userId: missing.userId,
      },
    })
    const missingMe = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${missing.accessToken}`,
      },
    })
    expect(missingMe.status).toBe(401)
  })

  test('enforces absolute session lifetime in PostgreSQL for access and refresh credentials', async () => {
    const absoluteExpired = await registerForMeGuard('absolute-expired')
    await prisma.authSession.updateMany({
      where: { userId: absoluteExpired.userId },
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 + 60) * 1000,
        ),
      },
    })

    const expiredMe = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${absoluteExpired.accessToken}` },
    })
    const expiredRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: absoluteExpired.refreshToken }),
    })

    expect(expiredMe.status).toBe(401)
    expect(expiredRefresh.status).toBe(401)

    const nearCutoff = await registerForMeGuard('absolute-near-cutoff')
    await prisma.authSession.updateMany({
      where: { userId: nearCutoff.userId },
      data: {
        createdAt: new Date(
          Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60 - 60) * 1000,
        ),
      },
    })

    const activeMe = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${nearCutoff.accessToken}` },
    })
    const activeRefresh = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: nearCutoff.refreshToken }),
    })

    expect(activeMe.status).toBe(200)
    expect(activeRefresh.status).toBe(200)
  })

  test('rejects duplicate login and invalid login', async () => {
    const payload = {
      login: 'dupe',
      password: 'password123',
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
    }

    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const duplicate = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(duplicate.status).toBe(409)

    const invalidLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: payload.login,
        password: 'wrong-password',
      }),
    })
    expect(invalidLogin.status).toBe(401)
    expect(securityEvents).toContainEqual(expect.objectContaining({
      code: 'UNAUTHORIZED',
      outcome: 'denied',
      reason: 'invalid_credentials',
      type: 'authentication_rejected',
    }))
  })

  test('rehashes a verified legacy password and never exposes password material', async () => {
    const password = 'correct horse battery staple'
    const legacyHash = await Bun.password.hash(password, {
      algorithm: 'argon2id',
      memoryCost: 19_456,
      timeCost: 2,
    })
    await prisma.user.create({
      data: {
        login: 'legacy-password',
        passwordHash: legacyHash,
      },
    })

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'legacy-password', password }),
    })
    const responseText = await login.text()
    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { login: 'legacy-password' },
    })

    expect(login.status).toBe(200)
    if (!storedUser.passwordHash) throw new Error('Expected a password credential')
    expect(storedUser.passwordHash).toStartWith('$argon2id$v=19$m=65536,t=2,p=1$')
    expect(storedUser.passwordHash).not.toBe(legacyHash)
    expect(await Bun.password.verify(password, storedUser.passwordHash)).toBe(true)
    expect(responseText).not.toContain(password)
    expect(responseText).not.toContain(legacyHash)
    expect(responseText).not.toContain(storedUser.passwordHash)
  })

  test('treats a non-password account record as invalid credentials', async () => {
    await prisma.user.create({
      data: {
        login: 'oauth-only',
        passwordHash: 'OAUTH_USER',
      },
    })

    const login = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'oauth-only', password: 'password123' }),
    })

    expect(login.status).toBe(401)
    expect(await login.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid login or password' },
    })
  })

  test('rejects a competing Yandex registration while preserving linked sign-in conflicts', async () => {
    const repository = createPrismaAuthRepository(prisma, env.JWT_SECRET)
    const complete = (
      suffix: string,
      canonicalKey = 'player@yandex.ru',
      providerValue = 'Player@yandex.ru',
    ) => repository.completeOAuthSignIn({
      accountEmail: {
        kind: 'candidate',
        canonicalKey,
        providerValue,
      },
      identity: { provider: 'yandex', subject: `provider-${suffix}` },
      newUser: {
        displayName: `Player ${suffix}`,
        legalAcceptance: {
          acceptedAt: new Date('2026-08-22T12:00:00.000Z'),
          privacyConsentVersion: '1.1',
          termsVersion: '1.1',
        },
        login: `oauth-yandex-${suffix}`,
      },
      session: {
        expiresAt: new Date('2026-09-22T12:00:00.000Z'),
        metadata: {},
        refreshTokenFamilyHash: `family-${suffix}`,
        refreshTokenHash: `refresh-${suffix}`,
      },
    })

    const concurrent = await Promise.allSettled([complete('one'), complete('two')])
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(concurrent.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { kind: 'oauth_account_email_conflict' },
    })

    const winnerSuffix = concurrent[0].status === 'fulfilled' ? 'one' : 'two'
    const loserSuffix = winnerSuffix === 'one' ? 'two' : 'one'
    let users = await prisma.user.findMany({
      where: { login: { in: ['oauth-yandex-one', 'oauth-yandex-two'] } },
      orderBy: { login: 'asc' },
    })

    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({
      accountEmailCanonicalKey: 'player@yandex.ru',
      accountEmailState: 'yandex_managed',
      login: `oauth-yandex-${winnerSuffix}`,
      passwordHash: null,
    })
    expect(await prisma.authIdentity.count({
      where: { subject: { in: ['provider-one', 'provider-two'] } },
    })).toBe(1)
    expect(await prisma.authSession.count({
      where: { userId: { in: users.map((candidate) => candidate.id) } },
    })).toBe(1)

    await expect(complete(
      loserSuffix,
      'alternate@yandex.ru',
      'Alternate@yandex.ru',
    )).resolves.toBeTruthy()
    users = await prisma.user.findMany({
      where: { login: { in: ['oauth-yandex-one', 'oauth-yandex-two'] } },
      orderBy: { login: 'asc' },
    })
    expect(users).toHaveLength(2)

    const managed = users.find((candidate) => candidate.login === `oauth-yandex-${winnerSuffix}`)!
    const conflicted = users.find((candidate) => candidate.login === `oauth-yandex-${loserSuffix}`)!
    const managedIdentity = await prisma.authIdentity.findFirstOrThrow({
      where: { userId: managed.id },
      select: { subject: true },
    })
    const conflictedIdentity = await prisma.authIdentity.findFirstOrThrow({
      where: { userId: conflicted.id },
      select: { subject: true },
    })
    const completeExisting = (
      subject: string,
      canonicalKey: string,
      providerValue: string,
      sessionSuffix: string,
    ) => repository.completeOAuthSignIn({
      accountEmail: { kind: 'candidate', canonicalKey, providerValue },
      identity: { provider: 'yandex', subject },
      session: {
        expiresAt: new Date('2026-09-22T12:00:00.000Z'),
        metadata: {},
        refreshTokenFamilyHash: `existing-family-${sessionSuffix}`,
        refreshTokenHash: `existing-refresh-${sessionSuffix}`,
      },
    })

    await expect(completeExisting(
      conflictedIdentity.subject,
      'player@yandex.ru',
      'Player@yandex.ru',
      'occupied',
    )).resolves.toMatchObject({ user: { id: conflicted.id } })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: conflicted.id } }))
      .toMatchObject({
        accountEmailCanonicalKey: null,
        accountEmailProviderValue: null,
        accountEmailState: 'yandex_conflict',
      })

    await expect(repository.completeOAuthSignIn({
      accountEmail: {
        kind: 'candidate',
        canonicalKey: 'changed@yandex.ru',
        providerValue: 'Changed@yandex.ru',
      },
      identity: { provider: 'yandex', subject: managedIdentity.subject },
      session: {
        expiresAt: new Date('2026-09-22T12:00:00.000Z'),
        metadata: {},
        refreshTokenFamilyHash: `family-${winnerSuffix}`,
        refreshTokenHash: `refresh-${winnerSuffix}`,
      },
    })).rejects.toMatchObject({ code: 'P2002' })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: managed.id } }))
      .toMatchObject({ accountEmailCanonicalKey: 'player@yandex.ru' })

    await completeExisting(
      managedIdentity.subject,
      'changed@yandex.ru',
      'Changed@yandex.ru',
      'changed',
    )
    await completeExisting(
      conflictedIdentity.subject,
      'player@yandex.ru',
      'Player@yandex.ru',
      'released',
    )
    expect(await prisma.user.findUniqueOrThrow({ where: { id: managed.id } }))
      .toMatchObject({ accountEmailCanonicalKey: 'changed@yandex.ru' })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: conflicted.id } }))
      .toMatchObject({
        accountEmailCanonicalKey: 'player@yandex.ru',
        accountEmailState: 'yandex_managed',
      })

    await repository.eraseUserIdentity({
      now: new Date('2026-08-22T12:30:00.000Z'),
      userId: conflicted.id,
    })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: conflicted.id } }))
      .toMatchObject({
        accountEmailCanonicalKey: null,
        accountEmailProviderValue: null,
        accountEmailState: 'absent',
      })
    expect(await prisma.authIdentity.count({ where: { userId: conflicted.id } })).toBe(0)
    expect(await prisma.authSession.count({ where: { userId: conflicted.id } })).toBe(0)

    const reused = await complete('three')
    expect(reused?.user.id).not.toBe(conflicted.id)
    expect(reused?.user).toMatchObject({
      accountEmailCanonicalKey: 'player@yandex.ru',
      accountEmailState: 'yandex_managed',
    })
    const accessToken = await signAccessToken({
      login: reused!.user.login,
      sessionId: reused!.session.id,
      sub: reused!.user.id,
    }, env)
    const protection = await app.request('/api/auth/account-protection', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const protectionText = await protection.text()
    expect(protection.status).toBe(200)
    expect(JSON.parse(protectionText)).toEqual({
      accountProtection: {
        maskedAccountEmail: 'P***@yandex.ru',
        state: 'yandex_managed',
      },
    })
    expect(protectionText).not.toContain('Player@yandex.ru')
  })

  test('deleting an account removes auth links and its identifier from Tender history', async () => {
    const register = async (login: string, displayName: string) => {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          login,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      expect(response.status).toBe(201)
      return response.json()
    }
    const deletedAccount = await register('delete-me', 'Анна')
    const remainingAccount = await register('keep-me', 'Борис')
    const deletedUserId = deletedAccount.user.id as string
    const remainingUserId = remainingAccount.user.id as string
    await seedApprovedMailService(prisma, 'mail.ru')
    expect((await app.request('/api/auth/account-protection/recovery-email/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deletedAccount.accessToken}`,
        'Content-Type': 'application/json',
        'x-test-client-ip': '198.51.100.20',
      },
      body: JSON.stringify({ email: 'delete-me@mail.ru', password: 'password123' }),
    })).status).toBe(200)
    const tender = createPersistentTenderModule(prisma)
    const { tenderId } = await tender.createTender({
      players: [
        { displayName: 'Анна', id: deletedUserId, tiePriority: 1 },
        { displayName: 'Борис', id: remainingUserId, tiePriority: 2 },
      ],
    })
    await prisma.authIdentity.create({
      data: {
        provider: 'yandex',
        subject: 'deleted-provider-subject',
        userId: deletedUserId,
      },
    })

    const deleted = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${deletedAccount.accessToken}` },
    })

    expect(deleted.status).toBe(204)
    expect(await prisma.authIdentity.count({ where: { userId: deletedUserId } })).toBe(0)
    expect(await prisma.authSession.count({ where: { userId: deletedUserId } })).toBe(0)
    expect(await prisma.recoveryEmailChallenge.count({ where: { userId: deletedUserId } })).toBe(0)
    expect(await prisma.recoveryEmailBinding.count({ where: { userId: deletedUserId } })).toBe(0)
    expect(await prisma.mailOutboxMessage.findFirstOrThrow({
      select: { lastFailureCode: true, recipient: true, state: true, templatePayload: true },
    })).toEqual({
      lastFailureCode: 'owner_operation_cancelled',
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    })
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: deletedUserId },
      select: {
        displayName: true,
        privacyConsentAt: true,
        privacyConsentVersion: true,
        termsAcceptedAt: true,
        termsVersion: true,
      },
    })).toEqual({
      displayName: null,
      privacyConsentAt: null,
      privacyConsentVersion: null,
      termsAcceptedAt: null,
      termsVersion: null,
    })

    const oldPasswordLogin = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'delete-me', password: 'password123' }),
    })
    expect(oldPasswordLogin.status).toBe(401)

    const remainingView = await tender.readTenderView({
      playerId: remainingUserId,
      tenderId,
    })
    expect(JSON.stringify(remainingView)).not.toContain(deletedUserId)
    expect(remainingView.players).toContainEqual(expect.objectContaining({
      displayName: 'Deleted participant',
      playerId: expect.stringMatching(/^deleted-participant-/),
    }))
  })

  test('requires a recent sign-in before deleting an account, even after token refresh', async () => {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: 'delete-requires-recent-auth',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const account = await register.json()
    await prisma.authSession.updateMany({
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1_000) },
      where: { userId: account.user.id },
    })

    const refreshed = await app.request('/api/auth/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: account.refreshToken }),
    })
    expect(refreshed.status).toBe(200)
    const refreshedSession = await refreshed.json()

    const deleted = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${refreshedSession.accessToken}` },
    })

    expect(deleted.status).toBe(403)
    expect(await deleted.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Recent authentication is required to delete the account',
      },
    })
    expect(await prisma.user.findUnique({
      where: { id: account.user.id },
      select: { passwordHash: true },
    })).toEqual({ passwordHash: expect.any(String) })
  })

  test('limits password login after five failures and resets the login budget on success', async () => {
    const login = 'password-attempt-budget'
    const password = 'password123'
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password,
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    expect(register.status).toBe(201)

    const attempt = (attemptPassword: string) => app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: attemptPassword }),
    })

    for (let index = 0; index < 4; index += 1) {
      const failure = await attempt('wrong-password')
      expect(failure.status).toBe(401)
      expect(await failure.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Invalid login or password' },
      })
    }

    expect((await attempt(password)).status).toBe(200)

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt('wrong-password')).status).toBe(401)
    }
    const limited = await attempt('wrong-password')
    expect(limited.status).toBe(429)
    const retryAfter = Number(limited.headers.get('retry-after'))
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    expect(await limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Invalid login or password. Try again later.',
      },
    })

    const unknown = await app.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'unknown-password-budget', password: 'wrong-password' }),
    })
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Invalid login or password' },
    })
  })

  test('atomically limits six concurrent password failures for one login', async () => {
    const login = 'concurrent-password-budget'
    await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const attempts = await Promise.all(Array.from({ length: 6 }, () =>
      app.request('/api/auth/token/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password: 'wrong-password' }),
      })))

    expect(attempts.map((response) => response.status).sort()).toEqual([
      401, 401, 401, 401, 401, 429,
    ])
  })

  test('uses a validated runtime override for the distributed login budget', async () => {
    const configuredApp = createApp({
      env: { ...env, ANTI_ABUSE_LOGIN_FAILURE_LIMIT: 2 },
      prisma,
    })
    const login = 'configured-password-budget'
    expect((await configuredApp.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })).status).toBe(201)
    const attempt = () => configuredApp.request('/api/auth/token/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: 'wrong-password' }),
    })

    expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(401)
    const limited = await attempt()
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  test('limits password verification by client address independently from login buckets', async () => {
    const attempt = (index: number, ipAddress: string) => app.request('/api/auth/token/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': ipAddress,
      },
      body: JSON.stringify({
        login: `unknown-ip-budget-${index}`,
        password: 'wrong-password',
      }),
    })

    for (let index = 1; index <= 30; index += 1) {
      expect((await attempt(index, '203.0.113.20')).status).toBe(401)
    }
    const limited = await attempt(31, '203.0.113.20')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    for (let index = 32; index <= 35; index += 1) {
      expect((await attempt(index, '203.0.113.20')).status).toBe(429)
    }
    expect(await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'login_ip_attempt' },
      select: { count: true },
    })).toEqual({ count: 31 })
    expect((await attempt(31, '203.0.113.21')).status).toBe(401)
  }, 10_000)

  test('returns one created user and one conflict for concurrent duplicate registration', async () => {
    const payload = {
      login: 'register-race',
      password: 'password123',
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
    }

    const [first, second] = await Promise.all([
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ])

    const statuses = [first.status, second.status].sort((left, right) => left - right)
    expect(statuses).toEqual([201, 409])

    const users = await prisma.user.count({
      where: {
        login: payload.login,
      },
    })
    expect(users).toBe(1)
  })

  test('allows only three password registrations for one signed browser device token', async () => {
    const register = (login: string, cookie?: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })

    const first = await register('device-quota-1')
    expect(first.status).toBe(201)
    const firstBody = await first.json()
    const deviceCookie = first.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .find((cookie) => cookie.startsWith('anomaly_detector_device='))
    expect(deviceCookie).toBeString()
    expect(first.headers.getSetCookie().find((cookie) =>
      cookie.startsWith('anomaly_detector_device='))).toContain('HttpOnly')

    expect((await register('device-quota-2', deviceCookie)).status).toBe(201)
    const concurrent = await Promise.all([
      register('device-quota-3', deviceCookie),
      register('device-quota-4', deviceCookie),
    ])
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 429])

    const fourth = await register('device-quota-5', deviceCookie)
    expect(fourth.status).toBe(429)
    const deviceRetryAfter = Number(fourth.headers.get('Retry-After'))
    expect(deviceRetryAfter).toBeGreaterThan(0)
    expect(deviceRetryAfter).toBeLessThanOrEqual(180 * 24 * 60 * 60)
    expect(await fourth.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Registration limit reached. Try again later.',
      },
    })

    const deleteFirstAccount = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${firstBody.accessToken}` },
    })
    expect(deleteFirstAccount.status).toBe(204)
    expect((await register('device-quota-after-delete', deviceCookie)).status).toBe(429)

    const forged = await register(
      'device-quota-forged',
      'anomaly_detector_device=forged.invalid',
    )
    expect(forged.status).toBe(201)
    expect(forged.headers.getSetCookie().some((cookie) =>
      cookie.startsWith('anomaly_detector_device=')
      && !cookie.startsWith('anomaly_detector_device=forged.invalid'))).toBe(true)
  })

  test('applies an independent wider IP budget to password registrations', async () => {
    for (let index = 1; index <= 20; index += 1) {
      const response = await app.request('/api/auth/token/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': '203.0.113.10',
        },
        body: JSON.stringify({
          login: `registration-ip-budget-${index}`,
          password: 'password123',
          privacyConsent: true,
          privacyConsentVersion: '1.1',
          termsAccepted: true,
          termsVersion: '1.1',
        }),
      })
      expect(response.status).toBe(201)
    }

    const limited = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-client-ip': '203.0.113.10',
      },
      body: JSON.stringify({
        login: 'registration-ip-budget-limited',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    expect(limited.status).toBe(429)
    const ipRetryAfter = Number(limited.headers.get('Retry-After'))
    expect(ipRetryAfter).toBeGreaterThan(0)
    expect(ipRetryAfter).toBeLessThanOrEqual(24 * 60 * 60)
  })

  async function registerForMeGuard(login: string) {
    const register = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    const registerBody = await register.json()
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        login,
      },
      select: {
        id: true,
      },
    })

    expect(register.status).toBe(201)
    expect(registerBody.accessToken).toBeString()

    return {
      accessToken: registerBody.accessToken as string,
      refreshToken: registerBody.refreshToken as string,
      userId: user.id,
    }
  }

  async function registerTokenAccount(login: string) {
    const response = await app.request('/api/auth/token/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    })
    expect(response.status).toBe(201)
    return response.json()
  }
})

async function seedApprovedMailService(prisma: DbClient, emailDomain: string) {
  const sourceImport = await prisma.mailRegistryImport.create({
    data: {
      actorId: crypto.randomUUID(),
      addedDomains: [emailDomain],
      checksum: 'a'.repeat(64),
      outcome: 'succeeded',
      removedDomains: [],
      sourceDate: '2026-08-22',
      sourceUrl: 'https://example.test/registry.xml',
      unchangedCount: 0,
    },
  })
  const candidate = await prisma.mailRegistryCandidate.create({
    data: {
      evidence: 'service_description_mentions_mail',
      importId: sourceImport.id,
      registryEntryId: `test-${emailDomain}`,
      serviceDomain: emailDomain,
    },
  })
  await prisma.mailPolicyVersion.create({
    data: {
      publishedBy: crypto.randomUUID(),
      version: 1,
      entries: {
        create: {
          emailDomain,
          ignoreDots: false,
          localPartCaseInsensitive: true,
          sourceCandidateId: candidate.id,
          state: 'approved',
          stripPlusTag: false,
        },
      },
    },
  })
}

async function seedActiveRecoveryEmail(
  prisma: DbClient,
  input: { canonicalKey: string; providerValue: string; userId: string },
) {
  await prisma.recoveryEmailBinding.create({
    data: {
      activatesAt: new Date(Date.now() - 60_000),
      cancellationSessionIds: [],
      canonicalKey: input.canonicalKey,
      policyVersion: 1,
      providerValue: input.providerValue,
      requestedAt: new Date(Date.now() - 86_400_000),
      userId: input.userId,
    },
  })
}

async function expireRecoveryEmailMinuteBudgets(prisma: DbClient) {
  await prisma.authAbuseBucket.updateMany({
    where: { scope: { endsWith: '_min' } },
    data: { expiresAt: new Date(Date.now() - 1) },
  })
}

async function publishMailServiceState(
  prisma: DbClient,
  emailDomain: string,
  state: 'blocked' | 'deprecated',
) {
  const candidate = await prisma.mailRegistryCandidate.findFirstOrThrow({
    where: { serviceDomain: emailDomain },
  })
  await prisma.mailPolicyVersion.create({
    data: {
      publishedBy: crypto.randomUUID(),
      version: 2,
      entries: {
        create: {
          emailDomain,
          ignoreDots: false,
          localPartCaseInsensitive: true,
          reason: 'integration state transition',
          sourceCandidateId: candidate.id,
          state,
          stripPlusTag: false,
        },
      },
    },
  })
}
