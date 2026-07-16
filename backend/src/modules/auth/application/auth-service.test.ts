import { expect, test } from 'bun:test'

import type { AuthRepository } from './ports'
import { AuthService } from './auth-service'

const user = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'password-hash',
  displayName: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

test('refresh keeps the logical session id stable while rotating its credential', async () => {
  const signedSessionIds: string[] = []
  const refreshCutoffs: Date[] = []
  const repository = {
    findUserByEmail: async () => null,
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
  } satisfies AuthRepository

  const service = new AuthService({
    accessTokens: {
      sign: async (payload) => {
        signedSessionIds.push(payload.sessionId)
        return 'access-token'
      },
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-stable' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: {
      hash: async () => 'password-hash',
      verify: async () => true,
    },
    projectUser: async (record) => ({
      id: record.id,
      email: record.email,
      displayName: record.displayName,
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
  const repository = {
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
  } as unknown as AuthRepository
  const service = new AuthService({
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-compromised' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    projectUser: async () => ({
      id: user.id,
      email: user.email,
      displayName: null,
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
  const repository = {
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
  } as unknown as AuthRepository
  const service = new AuthService({
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-stable' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    projectUser: async () => ({
      id: user.id,
      email: user.email,
      displayName: null,
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
