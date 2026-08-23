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
