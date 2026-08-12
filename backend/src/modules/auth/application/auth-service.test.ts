import { expect, test } from 'bun:test'

import type { AuthRepository } from './ports'
import { AuthService } from './auth-service'

const user = {
  id: 'user-1',
  login: 'user',
  passwordHash: 'password-hash',
  displayName: null,
  locale: 'ru',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const unconfiguredRepositoryMethod = (name: keyof AuthRepository) => async (): Promise<never> => {
  throw new Error(`AuthRepository.${name} is not configured for this scenario`)
}

const defaultAuthRepository: AuthRepository = {
  findUserByLogin: unconfiguredRepositoryMethod('findUserByLogin'),
  updatePasswordHash: unconfiguredRepositoryMethod('updatePasswordHash'),
  createPasswordUserWithSession: unconfiguredRepositoryMethod('createPasswordUserWithSession'),
  createSession: unconfiguredRepositoryMethod('createSession'),
  findActiveRefreshSession: unconfiguredRepositoryMethod('findActiveRefreshSession'),
  rotateRefreshSession: unconfiguredRepositoryMethod('rotateRefreshSession'),
  revokeSessionById: unconfiguredRepositoryMethod('revokeSessionById'),
  findActiveAccessSession: unconfiguredRepositoryMethod('findActiveAccessSession'),
  revokeSession: unconfiguredRepositoryMethod('revokeSession'),
  updateUser: unconfiguredRepositoryMethod('updateUser'),
  eraseUserIdentity: unconfiguredRepositoryMethod('eraseUserIdentity'),
  createOAuthTransaction: unconfiguredRepositoryMethod('createOAuthTransaction'),
  consumeOAuthTransactionByState: unconfiguredRepositoryMethod('consumeOAuthTransactionByState'),
  findUserByIdentity: unconfiguredRepositoryMethod('findUserByIdentity'),
  createOAuthUserWithSession: unconfiguredRepositoryMethod('createOAuthUserWithSession'),
}

const createAuthRepository = (
  overrides: Partial<AuthRepository>,
): AuthRepository => ({ ...defaultAuthRepository, ...overrides })

test('login opportunistically replaces a verified password hash that no longer meets policy', async () => {
  const passwordHashUpdates: Array<{
    userId: string
    currentPasswordHash: string
    nextPasswordHash: string
  }> = []
  const repository = createAuthRepository({
    findUserByLogin: async () => user,
    updatePasswordHash: async (input: {
      userId: string
      currentPasswordHash: string
      nextPasswordHash: string
    }) => {
      passwordHashUpdates.push(input)
    },
    createSession: async () => ({ id: 'session-created' }),
  })
  const service = new AuthService({
    accessTokens: { sign: async () => 'access-token', verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-created' }) },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'current-policy-hash',
      needsRehash: () => true,
      verify: async () => true,
    },
    projectUser: async () => ({
      id: user.id,
      login: user.login,
      displayName: null,
      locale: 'ru',
      createdAt: user.createdAt.toISOString(),
    }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => token,
    },
    repository,
  })

  await service.login({ login: user.login, password: 'password123' }, {})

  expect(passwordHashUpdates).toEqual([{
    userId: user.id,
    currentPasswordHash: user.passwordHash,
    nextPasswordHash: 'current-policy-hash',
  }])
})

test('refresh keeps the logical session id stable while rotating its credential', async () => {
  const signedSessionIds: string[] = []
  const refreshCutoffs: Date[] = []
  const repository = createAuthRepository({
    findUserByLogin: async () => null,
    updatePasswordHash: async () => undefined,
    createPasswordUserWithSession: async () => ({ user, session: { id: 'session-created' } }),
    createSession: async () => ({ id: 'session-created' }),
    findActiveRefreshSession: async (input) => {
      refreshCutoffs.push(input.createdAfter)
      return {
        id: 'session-stable',
        userId: user.id,
        user,
        refreshTokenHash: 'hash:current-refresh-token',
        credentialState: 'current',
      }
    },
    rotateRefreshSession: async () => true,
    findActiveAccessSession: async () => null,
    revokeSessionById: async () => false,
    revokeSession: async () => null,
    updateUser: async () => undefined,
    eraseUserIdentity: async () => undefined,
    createOAuthTransaction: async () => undefined,
    consumeOAuthTransactionByState: async () => null,
    findUserByIdentity: async () => null,
    createOAuthUserWithSession: async () => ({ user, session: { id: 'session-created' } }),
  })

  const service = new AuthService({
    accessTokens: {
      sign: async (payload) => {
        signedSessionIds.push(payload.sessionId)
        return 'access-token'
      },
      verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-stable' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'password-hash',
      needsRehash: () => false,
      verify: async () => true,
    },
    projectUser: async (record) => ({
      id: record.id,
      login: record.login,
      displayName: record.displayName,
      locale: 'ru',
      createdAt: record.createdAt.toISOString(),
    }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'next-refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: () => 'next-refresh-token',
    },
    repository,
  })

  await service.refresh('current-refresh-token', {})

  expect(signedSessionIds).toEqual(['session-stable'])
  expect(refreshCutoffs).toEqual([new Date('2025-10-03T00:00:00.000Z')])
})

test('refresh revokes the logical session when a previous credential is reused after grace', async () => {
  const revokedSessionIds: string[] = []
  const repository = createAuthRepository({
    findActiveRefreshSession: async () => ({
      id: 'session-compromised',
      userId: user.id,
      user,
      refreshTokenHash: 'hash:attacker-current-token',
      credentialState: 'reused',
    }),
    revokeSessionById: async ({ sessionId }: { sessionId: string }) => {
      revokedSessionIds.push(sessionId)
      return true
    },
  })
  const service = new AuthService({
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-compromised' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({
      id: user.id,
      login: user.login,
      displayName: null,
      locale: 'ru',
      createdAt: user.createdAt.toISOString(),
    }),
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'next-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: () => 'next-token',
    },
    repository,
  })

  await expect(service.refresh('owner-previous-token', {})).rejects.toThrow('invalid or expired')
  expect(revokedSessionIds).toEqual(['session-compromised'])
})

test('refresh returns the winning successor when another request wins the rotation race', async () => {
  let findCalls = 0
  let rotateCalls = 0
  const repository = createAuthRepository({
    findActiveRefreshSession: async () => {
      findCalls += 1
      return {
        id: 'session-stable',
        userId: user.id,
        user,
        refreshTokenHash: findCalls === 1
          ? 'hash:shared-token'
          : 'hash:successor:shared-token',
        credentialState: findCalls === 1 ? 'current' : 'previous_within_grace',
      }
    },
    rotateRefreshSession: async () => {
      rotateCalls += 1
      return false
    },
  })
  const service = new AuthService({
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-stable' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({
      id: user.id,
      login: user.login,
      displayName: null,
      locale: 'ru',
      createdAt: user.createdAt.toISOString(),
    }),
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'initial-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => `successor:${token}`,
    },
    repository,
  })

  await expect(service.refresh('shared-token', {})).resolves.toMatchObject({
    accessToken: 'access-token',
    refreshToken: 'successor:shared-token',
  })
  expect(findCalls).toBe(2)
  expect(rotateCalls).toBe(1)
})

test('starts a provider-neutral OAuth sign-in with a persisted PKCE transaction', async () => {
  const transactions: Array<Record<string, unknown>> = []
  const dependencies: ConstructorParameters<typeof AuthService>[0] = {
    accessTokens: { sign: async () => 'access-token', verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-1' }) },
    clock: { now: () => new Date('2026-07-20T12:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({ id: user.id, login: user.login, displayName: null, locale: 'ru', createdAt: user.createdAt.toISOString() }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: { create: () => 'refresh-token', hash: (token) => `hash:${token}`, familyHash: (token) => `family:${token}`, rotate: (token) => token },
    repository: createAuthRepository({
      createOAuthTransaction: async (transaction: Record<string, unknown>) => { transactions.push(transaction) },
    }),
    oauthProviders: {
      require: () => ({
        authorizationUrl: ({ state, codeChallenge }: { state: string; codeChallenge: string }) => `https://provider.example/authorize?state=${state}&code_challenge=${codeChallenge}`,
        exchangeCode: async () => ({ accessToken: 'provider-token', providerSubject: 'provider-sub-1' }),
        getUserInfo: async () => ({ login: 'oauth', displayName: 'OAuth User', providerSubject: 'provider-sub-1' }),
      }),
    },
  }
  const service = new AuthService(dependencies)

  const result = await service.startOAuthSignIn({
    provider: 'yandex',
    redirectUri: 'https://app.example.ru/api/auth/oauth/yandex/callback',
    registration: {
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsAccepted: true,
      termsVersion: '1.0',
    },
    webappOrigin: 'https://app.example.ru',
  })

  expect(result.authorizationUrl).toContain('https://provider.example/authorize')
  expect(transactions).toEqual([expect.objectContaining({
    legalAcceptance: {
      acceptedAt: new Date('2026-07-20T12:00:00.000Z'),
      privacyConsentVersion: '1.0',
      termsVersion: '1.0',
    },
    provider: 'yandex',
  })])
})

test('consumes an OAuth transaction before provider exchange and rejects replay', async () => {
  let transactionAvailable = true
  let exchangeCalls = 0
  const service = new AuthService({
    accessTokens: { sign: async () => 'access-token', verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-1' }) },
    clock: { now: () => new Date('2026-07-20T12:00:00.000Z') },
    logoutCleanup: async () => undefined,
    oauthProviders: {
      require: () => ({
        authorizationUrl: () => 'https://provider.example/authorize',
        exchangeCode: async () => {
          exchangeCalls += 1
          return { accessToken: 'provider-token', providerSubject: 'provider-sub-1' }
        },
        getUserInfo: async () => ({ displayName: 'OAuth User', providerSubject: 'provider-sub-1' }),
      }),
    },
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({ id: user.id, login: user.login, displayName: null, locale: 'ru', createdAt: user.createdAt.toISOString() }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: { create: () => 'refresh-token', hash: (token) => `hash:${token}`, familyHash: (token) => `family:${token}`, rotate: (token) => token },
    repository: createAuthRepository({
      consumeOAuthTransactionByState: async () => {
        if (!transactionAvailable) return null
        transactionAvailable = false
        return {
          codeVerifier: 'verifier',
          expiresAt: new Date('2026-07-20T12:10:00.000Z'),
          provider: 'yandex',
          redirectUri: 'https://api.example.ru/api/auth/oauth/yandex/callback',
          state: 'state',
        }
      },
      findUserByIdentity: async () => user,
      createSession: async () => ({ id: 'session-1' }),
    }),
  })

  await expect(service.completeOAuthSignIn({
    code: 'authorization-code',
    metadata: {},
    state: 'state',
  })).resolves.toMatchObject({ accessToken: 'access-token' })
  await expect(service.completeOAuthSignIn({
    code: 'authorization-code',
    metadata: {},
    state: 'state',
  })).rejects.toMatchObject({ kind: 'oauth_transaction_invalid' })
  expect(exchangeCalls).toBe(1)
})

test('refuses to create an OAuth user without a separately confirmed legal acceptance', async () => {
  const service = new AuthService({
    accessTokens: { sign: async () => 'access-token', verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-1' }) },
    clock: { now: () => new Date('2026-07-20T12:00:00.000Z') },
    logoutCleanup: async () => undefined,
    oauthProviders: {
      require: () => ({
        authorizationUrl: () => 'https://provider.example/authorize',
        exchangeCode: async () => ({ accessToken: 'provider-token', providerSubject: 'new-provider-user' }),
        getUserInfo: async () => ({ displayName: 'OAuth User', providerSubject: 'new-provider-user' }),
      }),
    },
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({ id: user.id, login: user.login, displayName: null, locale: 'ru', createdAt: user.createdAt.toISOString() }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: { create: () => 'refresh-token', hash: (token) => `hash:${token}`, familyHash: (token) => `family:${token}`, rotate: (token) => token },
    repository: createAuthRepository({
      consumeOAuthTransactionByState: async () => ({
        codeVerifier: 'verifier',
        expiresAt: new Date('2026-07-20T12:10:00.000Z'),
        provider: 'yandex',
        redirectUri: 'https://api.example.ru/api/auth/oauth/yandex/callback',
        state: 'state',
      }),
      findUserByIdentity: async () => null,
    }),
  })

  await expect(service.completeOAuthSignIn({
    code: 'authorization-code',
    metadata: {},
    state: 'state',
  })).rejects.toMatchObject({ kind: 'oauth_registration_consent_required' })
})

test('limits a provider display name before creating an OAuth user', async () => {
  let createdDisplayName: string | null | undefined
  const service = new AuthService({
    accessTokens: { sign: async () => 'access-token', verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-1' }) },
    clock: { now: () => new Date('2026-07-20T12:00:00.000Z') },
    logoutCleanup: async () => undefined,
    oauthProviders: {
      require: () => ({
        authorizationUrl: () => 'https://provider.example/authorize',
        exchangeCode: async () => ({ accessToken: 'provider-token', providerSubject: 'new-provider-user' }),
        getUserInfo: async () => ({ displayName: 'Очень длинное имя пользователя', providerSubject: 'new-provider-user' }),
      }),
    },
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({ id: user.id, login: user.login, displayName: createdDisplayName ?? null, locale: 'ru', createdAt: user.createdAt.toISOString() }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: { create: () => 'refresh-token', hash: (token) => `hash:${token}`, familyHash: (token) => `family:${token}`, rotate: (token) => token },
    repository: createAuthRepository({
      consumeOAuthTransactionByState: async () => ({
        codeVerifier: 'verifier',
        expiresAt: new Date('2026-07-20T12:10:00.000Z'),
        legalAcceptance: {
          acceptedAt: new Date('2026-07-20T12:00:00.000Z'),
          privacyConsentVersion: '1.0',
          termsVersion: '1.0',
        },
        provider: 'yandex',
        redirectUri: 'https://api.example.ru/api/auth/oauth/yandex/callback',
        state: 'state',
      }),
      findUserByIdentity: async () => null,
      createOAuthUserWithSession: async (
        input: Parameters<AuthRepository['createOAuthUserWithSession']>[0],
      ) => {
        createdDisplayName = input.user.displayName
        return { session: { id: 'session-1' }, user }
      },
    }),
  })

  await service.completeOAuthSignIn({ code: 'authorization-code', metadata: {}, state: 'state' })

  expect(createdDisplayName).toBe('Очень длинное имя по')
  expect(createdDisplayName?.length).toBe(20)
})

test('deleteAccount removes identity links only after Tender history is anonymised', async () => {
  const operations: string[] = []
  const repository = createAuthRepository({
    eraseUserIdentity: async (input: { userId: string; now: Date }) => {
      operations.push(`erase:${input.userId}`)
    },
  })
  const service = new AuthService({
    accountDeletionCleanup: async ({ userId }) => { operations.push(`history:${userId}`) },
    accessTokens: { sign: async () => 'access-token', verify: async () => ({ sub: user.id, login: user.login, sessionId: 'session-1' }) },
    clock: { now: () => new Date('2026-07-20T12:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', needsRehash: () => false, verify: async () => true },
    projectUser: async () => ({ id: user.id, login: user.login, displayName: null, locale: 'ru', createdAt: user.createdAt.toISOString() }),
    refreshTokenTtlDays: 30,
    refreshReuseGraceSeconds: 10,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: { create: () => 'refresh-token', hash: (token) => `hash:${token}`, familyHash: (token) => `family:${token}`, rotate: (token) => token },
    repository,
  })

  await service.deleteAccount({
    authenticatedAt: new Date('2026-07-20T12:00:00.000Z'),
    userId: user.id,
  })

  expect(operations).toEqual([
    `history:${user.id}`,
    `erase:${user.id}`,
  ])
})
