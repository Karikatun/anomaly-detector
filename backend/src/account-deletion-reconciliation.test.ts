import { expect, test } from 'bun:test'

import type { DbClient } from './db'
import {
  accountDeletionClaimLeaseMs,
  claimDeletedAccountCleanupBatch,
  reconcileDeletedAccount,
  reconcileDeletedAccounts,
} from './account-deletion-reconciliation'
import { TenderVersionConflict } from './modules/tender'

test('claims only rows returned by the locked candidate query and persists the lease owner', async () => {
  const now = new Date('2026-09-04T13:00:00.000Z')
  let query = ''
  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      query = strings.join('?')
      return [{ failure_attempt_count: 2, id: 'claimed-account' }]
    },
  }
  const db = {
    $transaction: async (run: (value: typeof transaction) => unknown) => run(transaction),
  } as unknown as DbClient

  await expect(claimDeletedAccountCleanupBatch({
    db,
    limit: 1,
    now,
    workerId: 'account-cleanup-worker-a',
  })).resolves.toEqual([{
    failureAttemptCount: 2,
    id: 'claimed-account',
  }])
  expect(query).toContain('FOR UPDATE SKIP LOCKED')
  expect(query).toContain('deletion_cleanup_available_at')
  expect(query).toContain('deletion_cleanup_lease_expires_at')
  expect(query).toContain('deletion_cleanup_claim_owner')
  expect(accountDeletionClaimLeaseMs).toBe(35 * 60_000)
})

test('continues after a poisoned legacy tombstone and marks the remaining account', async () => {
  const now = new Date('2026-09-04T14:00:00.000Z')
  const updatedAccounts: string[] = []
  const failureUpdates: unknown[] = []
  const processingTransaction = {
    $queryRaw: async () => [],
    ...emptyAccountErasureModels(),
    feedbackReport: { updateMany: async () => ({ count: 0 }) },
    tender: { findMany: async () => [] },
    tenderRoom: { findFirst: async () => null, findMany: async () => [] },
    tenderRoomMember: { findMany: async () => [] },
    user: {
      findFirst: async (input: { where: { id: string } }) => {
        if (input.where.id === 'poisoned-account') throw new Error('legacy payload is invalid')
        return {
          deletionAuditPseudonym: null,
          id: input.where.id,
          login: 'deleted-repairable-account',
        }
      },
      update: async (input: {
        data: { deletionCleanupCompletedAt?: Date | null }
        where: { id: string }
      }) => {
        if (input.data.deletionCleanupCompletedAt instanceof Date) {
          updatedAccounts.push(input.where.id)
        }
        return { id: input.where.id }
      },
    },
  }
  const claimBatches = [
    [
      { failure_attempt_count: 12, id: 'poisoned-account' },
      { failure_attempt_count: 0, id: 'repairable-account' },
    ],
    [],
  ]
  const claimTransaction = {
    $queryRaw: async () => claimBatches.shift() ?? [],
  }
  const db = {
    $transaction: async (
      run: (value: typeof processingTransaction | typeof claimTransaction) => unknown,
      options?: unknown,
    ) => run(options ? processingTransaction : claimTransaction),
    user: {
      count: async () => 1,
      findFirst: async () => ({ anonymizedAt: new Date('2026-09-03T14:00:00.000Z') }),
      groupBy: async () => [{
        _count: { deletionCleanupLastFailureCode: 1 },
        deletionCleanupLastFailureCode: 'unexpected_failure',
      }],
      updateMany: async (input: unknown) => {
        failureUpdates.push(input)
        return { count: 1 }
      },
    },
  } as unknown as DbClient

  await expect(reconcileDeletedAccounts({
    db,
    lifecycleSecret: 'test-account-lifecycle-secret',
    now,
  })).resolves.toEqual({
    accounts: 1,
    deferredFailed: 1,
    deferredFailures: { unexpected_failure: 1 },
    failed: 1,
    failures: { unexpected_failure: 1 },
    hasMore: true,
    oldestPendingAt: new Date('2026-09-03T14:00:00.000Z'),
    overdue: true,
    pending: 1,
    tenders: 0,
  })
  expect(updatedAccounts).toEqual(['repairable-account'])
  expect(failureUpdates).toEqual([{
    data: {
      deletionCleanupAttemptCount: { increment: 1 },
      deletionCleanupAvailableAt: expect.any(Date),
      deletionCleanupClaimOwner: null,
      deletionCleanupLastFailureCode: 'unexpected_failure',
      deletionCleanupLeaseExpiresAt: null,
    },
    where: {
      deletionCleanupClaimOwner: expect.stringContaining('account-cleanup-'),
      deletionCleanupCompletedAt: null,
      id: 'poisoned-account',
    },
  }])
  const retryAt = (failureUpdates[0] as {
    data: { deletionCleanupAvailableAt: Date }
  }).data.deletionCleanupAvailableAt.getTime()
  expect(retryAt).toBeGreaterThanOrEqual(now.getTime() + 6 * 60 * 60_000)
  expect(retryAt).toBeLessThan(now.getTime() + 6 * 60 * 60_000 + 1_000)
})

test('retries a legacy cleanup after a stale Room row and keeps a bounded transaction', async () => {
  const now = new Date('2026-09-04T14:30:00.000Z')
  let attempts = 0
  const transactionOptions: unknown[] = []
  const transaction = {
    $queryRaw: async () => [],
    ...emptyAccountErasureModels(),
    feedbackReport: { updateMany: async () => ({ count: 0 }) },
    tender: { findMany: async () => [] },
    tenderRoom: { findFirst: async () => null, findMany: async () => [] },
    tenderRoomMember: { findMany: async () => [] },
    user: {
      findFirst: async () => ({
        deletionAuditPseudonym: null,
        id: 'legacy-account',
        login: 'deleted-legacy-account',
      }),
      update: async () => ({ id: 'legacy-account' }),
    },
  }
  const db = {
    $transaction: async (
      run: (value: typeof transaction) => unknown,
      options: unknown,
    ) => {
      attempts += 1
      transactionOptions.push(options)
      if (attempts === 1) throw { code: 'P2025' }
      return run(transaction)
    },
  } as unknown as DbClient

  await expect(reconcileDeletedAccount({
    db,
    lifecycleSecret: 'test-account-lifecycle-secret',
    now,
  }, 'legacy-account')).resolves.toMatchObject({ completed: true })
  expect(attempts).toBe(2)
  expect(transactionOptions).toEqual([
    { isolationLevel: 'Serializable', timeout: 15_000 },
    { isolationLevel: 'Serializable', timeout: 15_000 },
  ])
})

test('retries the whole bounded pass after a concurrent Tender version change', async () => {
  let attempts = 0
  const transaction = {
    $queryRaw: async () => [],
    ...emptyAccountErasureModels(),
    feedbackReport: { updateMany: async () => ({ count: 0 }) },
    tender: { findMany: async () => [] },
    tenderRoom: { findFirst: async () => null, findMany: async () => [] },
    tenderRoomMember: { findMany: async () => [] },
    user: {
      findFirst: async () => ({
        deletionAuditPseudonym: null,
        id: 'legacy-account',
        login: 'deleted-legacy-account',
      }),
      update: async () => ({ id: 'legacy-account' }),
    },
  }
  const db = {
    $transaction: async (run: (value: typeof transaction) => unknown) => {
      attempts += 1
      if (attempts === 1) throw new TenderVersionConflict()
      return run(transaction)
    },
  } as unknown as DbClient

  await expect(reconcileDeletedAccount({
    db,
    lifecycleSecret: 'test-account-lifecycle-secret',
    now: new Date('2026-09-04T14:45:00.000Z'),
  }, 'legacy-account')).resolves.toMatchObject({ completed: true })
  expect(attempts).toBe(2)
})

test('checks the remaining marker-null rows after a full successful batch', async () => {
  const transaction = {
    $queryRaw: async () => [],
    ...emptyAccountErasureModels(),
    feedbackReport: { updateMany: async () => ({ count: 0 }) },
    tender: { findMany: async () => [] },
    tenderRoom: { findFirst: async () => null, findMany: async () => [] },
    tenderRoomMember: { findMany: async () => [] },
    user: {
      findFirst: async (input: { where: { id: string } }) => ({
        deletionAuditPseudonym: null,
        id: input.where.id,
        login: `deleted-${input.where.id}`,
      }),
      update: async () => ({ id: 'updated' }),
    },
  }
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    failure_attempt_count: 0,
    id: `legacy-${index}`,
  }))
  const claimBatches = [candidates, []]
  const claimTransaction = {
    $queryRaw: async () => claimBatches.shift() ?? [],
  }
  const db = {
    $transaction: async (
      run: (value: typeof transaction | typeof claimTransaction) => unknown,
      options?: unknown,
    ) => run(options ? transaction : claimTransaction),
    user: {
      count: async () => 0,
      groupBy: async () => [],
    },
  } as unknown as DbClient

  await expect(reconcileDeletedAccounts({
    db,
    lifecycleSecret: 'test-account-lifecycle-secret',
    now: new Date('2026-09-04T15:00:00.000Z'),
  })).resolves.toMatchObject({
    accounts: 25,
    failed: 0,
    hasMore: false,
    pending: 0,
  })
})

test('renews an unfinished claim locally and releases it when the work budget is exhausted', async () => {
  const now = new Date('2026-09-04T15:30:00.000Z')
  const claimBatches = [[{ failure_attempt_count: 0, id: 'large-account' }]]
  const rootUpdates: unknown[] = []
  const claimTransaction = {
    $queryRaw: async () => claimBatches.shift() ?? [],
  }
  const processingTransaction = {
    $queryRaw: async () => [],
    ...emptyAccountErasureModels(),
    currentMatch: { deleteMany: async () => ({ count: 0 }) },
    feedbackReport: { updateMany: async () => ({ count: 0 }) },
    tender: { findMany: async () => [] },
    tenderRoom: {
      delete: async () => ({ id: 'room-1' }),
      findMany: async (input: { include?: unknown; select?: unknown }) => input.select
        ? [{ id: 'room-1' }, { id: 'room-2' }]
        : [{ hostId: 'large-account', id: 'room-1', members: [], status: 'waiting' }],
    },
    tenderRoomMember: { findMany: async () => [] },
    user: {
      findFirst: async () => ({
        deletionAuditPseudonym: null,
        id: 'large-account',
        login: 'deleted-large-account',
      }),
      update: async () => ({ id: 'large-account' }),
    },
  }
  const db = {
    $transaction: async (
      run: (value: typeof processingTransaction | typeof claimTransaction) => unknown,
      options?: unknown,
    ) => run(options ? processingTransaction : claimTransaction),
    user: {
      count: async () => 1,
      findFirst: async () => ({ anonymizedAt: now }),
      groupBy: async () => [],
      updateMany: async (input: unknown) => {
        rootUpdates.push(input)
        return { count: 1 }
      },
    },
  } as unknown as DbClient

  await expect(reconcileDeletedAccounts({
    db,
    lifecycleSecret: 'test-account-lifecycle-secret',
    now,
  })).resolves.toMatchObject({ accounts: 1, failed: 0, pending: 1 })
  expect(rootUpdates).toEqual([{
    data: {
      deletionCleanupAvailableAt: expect.any(Date),
      deletionCleanupClaimOwner: null,
      deletionCleanupLeaseExpiresAt: null,
    },
    where: {
      deletionCleanupClaimOwner: expect.stringContaining('account-cleanup-'),
      deletionCleanupCompletedAt: null,
      id: { in: ['large-account'] },
    },
  }])
})

function emptyAccountErasureModels() {
  const emptyCredential = {
    deleteMany: async () => ({ count: 0 }),
    findUnique: async () => null,
  }
  const emptyOperatorAudit = {
    findFirst: async () => null,
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
  }
  return {
    authIdentity: { deleteMany: async () => ({ count: 0 }) },
    authSession: { deleteMany: async () => ({ count: 0 }) },
    currentMatch: { deleteMany: async () => ({ count: 0 }) },
    feedbackAuditEvent: emptyOperatorAudit,
    feedbackOperatorCommand: emptyOperatorAudit,
    mailPolicyAuditEvent: emptyOperatorAudit,
    mailPolicyCommand: emptyOperatorAudit,
    mailPolicyVersion: emptyOperatorAudit,
    passwordResetCredential: emptyCredential,
    recoveryCode: { deleteMany: async () => ({ count: 0 }) },
    recoveryCodeEmailReplacement: emptyCredential,
    recoveryCodeReissueChallenge: emptyCredential,
    recoveryCodeSet: { deleteMany: async () => ({ count: 0 }) },
    recoveryEmailBinding: { deleteMany: async () => ({ count: 0 }) },
    recoveryEmailChallenge: emptyCredential,
    recoveryEmailReplacement: emptyCredential,
  }
}
