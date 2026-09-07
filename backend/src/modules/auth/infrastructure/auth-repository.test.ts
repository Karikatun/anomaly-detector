import { expect, spyOn, test } from 'bun:test'

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

test('runs dependent account cleanup inside the identity erasure transaction', async () => {
  const cleanupFailure = new Error('dependent cleanup failed')
  const transactionClient = accountErasureTransaction()
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient
  let receivedTransaction: unknown

  const repository = createPrismaAuthRepository(db, 'test-abuse-secret', {
    accountDeletionCleanup: async (transaction, input) => {
      receivedTransaction = transaction
      expect(input.userId).toBe('user-1')
      throw cleanupFailure
    },
  })

  await expect(repository.eraseUserIdentity({
    now: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
  })).rejects.toBe(cleanupFailure)
  expect(receivedTransaction).toBe(transactionClient)
})

test('runs the post-commit notification once after a retried account erasure commits', async () => {
  const transactionClient = accountErasureTransaction()
  const transactionOptions: unknown[] = []
  let attempts = 0
  let notifications = 0
  const db = {
    $transaction: async (
      run: (tx: typeof transactionClient) => unknown,
      options: unknown,
    ) => {
      attempts += 1
      transactionOptions.push(options)
      if (attempts === 1) throw { code: 'P2034' }
      return run(transactionClient)
    },
  } as unknown as DbClient
  const repository = createPrismaAuthRepository(db, 'test-abuse-secret', {
    accountDeletionCleanup: async () => ({
      afterCommit: () => { notifications += 1 },
    }),
  })

  await repository.eraseUserIdentity({
    now: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
  })

  expect(attempts).toBe(2)
  expect(notifications).toBe(1)
  expect(transactionOptions).toEqual([
    { isolationLevel: 'Serializable', timeout: 30_000 },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  ])
})

test('does not run the post-commit notification when account erasure rolls back', async () => {
  const transactionFailure = new Error('identity tombstone failed')
  const transactionClient = accountErasureTransaction({
    updateUser: async () => { throw transactionFailure },
  })
  let notifications = 0
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient
  const repository = createPrismaAuthRepository(db, 'test-abuse-secret', {
    accountDeletionCleanup: async () => ({
      afterCommit: () => { notifications += 1 },
    }),
  })

  await expect(repository.eraseUserIdentity({
    now: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
  })).rejects.toBe(transactionFailure)
  expect(notifications).toBe(0)
})

test('keeps a committed account erasure successful when its notification fails', async () => {
  let tombstone: { deletionCleanupCompletedAt?: Date | null } | undefined
  const transactionClient = accountErasureTransaction({
    updateUser: async (input) => {
      tombstone = input.data
      return { id: 'user-1' }
    },
  })
  const notificationFailure = new Error('notification transport failed')
  const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient
  const repository = createPrismaAuthRepository(db, 'test-abuse-secret', {
    accountDeletionCleanup: async () => ({
      afterCommit: async () => { throw notificationFailure },
    }),
  })

  try {
    await expect(repository.eraseUserIdentity({
      now: new Date('2026-01-01T00:00:00.000Z'),
      userId: 'user-1',
    })).resolves.toBeUndefined()
    expect(tombstone?.deletionCleanupCompletedAt).toBeNull()
    expect(consoleError).toHaveBeenCalledWith(
      'Account deletion reconciliation remains pending after identity erasure.',
    )
  } finally {
    consoleError.mockRestore()
  }
})

test('does not tombstone or schedule cleanup twice for repeated account deletion', async () => {
  let active = true
  let cleanupRuns = 0
  let tombstones = 0
  const transactionClient = accountErasureTransaction({
    activeUser: () => active,
    updateUser: async () => {
      active = false
      tombstones += 1
      return { id: 'user-1' }
    },
  })
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient
  const repository = createPrismaAuthRepository(db, 'test-abuse-secret', {
    accountDeletionCleanup: async () => {
      cleanupRuns += 1
      return { afterCommit: () => undefined }
    },
  })

  await repository.eraseUserIdentity({
    now: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
  })
  await repository.eraseUserIdentity({
    now: new Date('2026-01-01T00:01:00.000Z'),
    userId: 'user-1',
  })

  expect(cleanupRuns).toBe(1)
  expect(tombstones).toBe(1)
})

test('rejects a profile update after account deletion wins the lifecycle lock', async () => {
  const operations: string[] = []
  const transactionClient = {
    $queryRaw: async () => {
      operations.push('lifecycle-lock')
      return []
    },
    user: {
      updateMany: async () => {
        operations.push('active-user-update')
        return { count: 0 }
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  await expect(createPrismaAuthRepository(db, 'test-abuse-secret').updateUser({
    displayName: 'Restored identity',
    userId: 'user-1',
  })).rejects.toMatchObject({ kind: 'session_invalid' })
  expect(operations).toEqual(['lifecycle-lock', 'active-user-update'])
})

test('does not restore an OAuth identity after account deletion wins the lifecycle lock', async () => {
  const operations: string[] = []
  const transactionClient = {
    $queryRaw: async () => {
      operations.push('lock')
      return []
    },
    authIdentity: {
      findUnique: async () => ({ userId: 'user-1' }),
    },
    user: {
      findFirst: async () => {
        operations.push('active-user-read')
        return null
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  await expect(createPrismaAuthRepository(db, 'test-abuse-secret').completeOAuthSignIn({
    accountEmail: { kind: 'unavailable' },
    identity: { provider: 'yandex', subject: 'subject-1' },
    session: {
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      metadata: {},
      refreshTokenFamilyHash: 'refresh-family-hash',
      refreshTokenHash: 'refresh-hash',
    },
  })).resolves.toBeNull()
  expect(operations).toEqual([
    'lock',
    'lock',
    'active-user-read',
  ])
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

function accountErasureTransaction(input: {
  activeUser?: () => boolean
  updateUser?: (input: {
    data: { deletionCleanupCompletedAt?: Date | null }
  }) => Promise<unknown>
} = {}) {
  const emptyCredential = {
    deleteMany: async () => ({ count: 0 }),
    findUnique: async () => null,
  }
  return {
    $queryRaw: async (query: TemplateStringsArray) =>
      query.join('').includes('FROM "users"') && (input.activeUser?.() ?? true)
        ? [{ id: 'user-1' }]
        : [],
    authIdentity: { deleteMany: async () => ({ count: 0 }) },
    authSession: { deleteMany: async () => ({ count: 0 }) },
    currentMatch: { deleteMany: async () => ({ count: 0 }) },
    passwordResetCredential: emptyCredential,
    recoveryCode: { deleteMany: async () => ({ count: 0 }) },
    recoveryCodeEmailReplacement: emptyCredential,
    recoveryCodeReissueChallenge: emptyCredential,
    recoveryCodeSet: { deleteMany: async () => ({ count: 0 }) },
    recoveryEmailBinding: { deleteMany: async () => ({ count: 0 }) },
    recoveryEmailChallenge: emptyCredential,
    recoveryEmailReplacement: emptyCredential,
    user: {
      update: input.updateUser ?? (async () => ({ id: 'user-1' })),
    },
  }
}
