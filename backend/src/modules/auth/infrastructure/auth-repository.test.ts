import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaAuthRepository } from './auth-repository'

test('creates a password user and initial session inside one database transaction', async () => {
  const operations: string[] = []
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const transactionClient = {
    user: {
      create: async () => {
        operations.push('user')
        return {
          id: 'user-1',
          login: 'user',
          passwordHash: 'password-hash',
          displayName: null,
  locale: 'ru',
          createdAt,
          updatedAt: createdAt,
        }
      },
    },
    authSession: {
      create: async () => {
        operations.push('session')
        return { id: 'session-1' }
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  const result = await createPrismaAuthRepository(db, 'test-abuse-secret').createPasswordUserWithSession({
    user: {
      login: 'user',
      legalAcceptedAt: createdAt,
      password: 'password123',
      passwordHash: 'password-hash',
      displayName: undefined,
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
    },
    session: {
      refreshTokenHash: 'refresh-hash',
      refreshTokenFamilyHash: 'refresh-family-hash',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      metadata: {},
    },
  })

  expect(operations).toEqual(['user', 'session'])
  expect(result).toMatchObject({
    user: { id: 'user-1' },
    session: { id: 'session-1' },
  })
})

test('retries an auth transaction after an adapter deadlock or stale record', async () => {
  let transactionAttempts = 0
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const transactionClient = {
    user: {
      create: async () => ({
        createdAt,
        displayName: null,
        id: 'user-1',
        locale: 'ru',
        login: 'user',
        passwordHash: 'password-hash',
        updatedAt: createdAt,
      }),
    },
    authSession: {
      create: async () => ({ id: 'session-1' }),
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => {
      transactionAttempts += 1
      if (transactionAttempts === 1) {
        throw {
          cause: { code: '40P01', kind: 'postgres' },
          name: 'DriverAdapterError',
        }
      }
      if (transactionAttempts === 2) throw { code: 'P2025' }
      return run(transactionClient)
    },
  } as unknown as DbClient

  await createPrismaAuthRepository(db, 'test-abuse-secret').createPasswordUserWithSession({
    user: {
      displayName: undefined,
      legalAcceptedAt: createdAt,
      login: 'user',
      password: 'password123',
      passwordHash: 'password-hash',
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
    },
    session: {
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      metadata: {},
      refreshTokenFamilyHash: 'refresh-family-hash',
      refreshTokenHash: 'refresh-hash',
    },
  })

  expect(transactionAttempts).toBe(3)
})

test('retries account erasure when retention wins a database deadlock', async () => {
  let transactionAttempts = 0
  const db = {
    $transaction: async () => {
      transactionAttempts += 1
      if (transactionAttempts === 1) {
        throw {
          cause: { code: '40P01', kind: 'postgres' },
          name: 'DriverAdapterError',
        }
      }
    },
  } as unknown as DbClient

  await createPrismaAuthRepository(db, 'test-abuse-secret').eraseUserIdentity({
    now: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
  })

  expect(transactionAttempts).toBe(2)
})

test('maps a replacement row removed by retention to an auth failure after retry', async () => {
  let transactionAttempts = 0
  const transactionClient = {
    $queryRaw: async () => [],
    authSession: { findFirst: async () => null },
    recoveryEmailBinding: { findUnique: async () => null },
    recoveryEmailReplacement: { findUnique: async () => null },
  }
  const db = {
    recoveryEmailReplacement: {
      findUnique: async () => ({
        id: 'replacement-1',
        newCanonicalKey: 'new@example.test',
        oldCanonicalKey: 'old@example.test',
      }),
    },
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => {
      transactionAttempts += 1
      if (transactionAttempts === 1) throw { code: 'P2025' }
      return run(transactionClient)
    },
  } as unknown as DbClient

  await expect(createPrismaAuthRepository(
    db,
    'test-abuse-secret-0000000000000000',
    { createMessageId: () => '019f8099-7e26-7760-ad08-66d1d66b2999' },
  ).resendRecoveryEmailReplacement({
    expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    factor: 'old',
    now: new Date('2026-01-01T00:00:00.000Z'),
    sessionId: 'session-1',
    userId: 'user-1',
  })).rejects.toMatchObject({ kind: 'recovery_replacement_forbidden' })
  expect(transactionAttempts).toBe(2)
})
