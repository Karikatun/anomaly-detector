import {
  isRetryableDatabaseTransactionConflict,
  type DbClient,
} from './db'
import { erasePrismaAccountIdentityInTransaction } from './modules/auth'
import {
  anonymizePrismaFeedbackOperatorActorBatch,
  unlinkFeedbackAccountInTransaction,
} from './modules/feedback'
import { anonymizePrismaMailOperatorActorBatch } from './modules/mail'
import { cleanupPrismaRoomBatchForAccountDeletion } from './modules/room'
import {
  anonymizePrismaTenderParticipantBatch,
  TenderVersionConflict,
} from './modules/tender'
import { lockAccountLifecycleTransaction } from './security/account-lifecycle-lock'

const reconciliationBatchSize = 25
const reconciliationWorkBudget = 50
const reconciliationTransactionMaxAttempts = 2
const reconciliationTransactionTimeoutMs = 15_000
const reconciliationFailureRetryBaseMs = 60_000
const reconciliationFailureRetryMaxMs = 6 * 60 * 60_000
export const operatorAuditActorCleanupBatchSize = 100
export const accountDeletionClaimLeaseMs = 35 * 60_000
export const accountDeletionCleanupSlaMs = 24 * 60 * 60_000

type ReconciliationFailureKind =
  | 'database_conflict'
  | 'database_failure'
  | 'legacy_data_invalid'
  | 'stale_reference'
  | 'transaction_timeout'
  | 'unexpected_failure'

export async function reconcileDeletedAccounts(input: {
  db: DbClient
  lifecycleSecret: string
  now: Date
}) {
  const workerId = `account-cleanup-${crypto.randomUUID()}`
  const currentTime = createMonotonicReconciliationClock(input.now)
  const accounts = new Set<string>()
  let failed = 0
  const failures: Partial<Record<ReconciliationFailureKind, number>> = {}
  let tenders = 0

  const claims = await claimDeletedAccountCleanupBatch({
    db: input.db,
    limit: reconciliationBatchSize,
    now: currentTime(),
    workerId,
  })
  const workQueue = [...claims]
  for (let work = 0; work < reconciliationWorkBudget && workQueue.length > 0; work += 1) {
    const claim = workQueue.shift()!
    const passNow = currentTime()
    try {
      const result = await reconcileDeletedAccount({
        ...input,
        claimOwner: workerId,
        now: passNow,
      }, claim.id)
      if (!result) continue
      accounts.add(claim.id)
      tenders += result.changedTenderIds.length
      if (!result.completed) {
        workQueue.push({ ...claim, failureAttemptCount: 0 })
      }
    } catch (error) {
      failed += 1
      const kind = classifyReconciliationFailure(error)
      failures[kind] = (failures[kind] ?? 0) + 1
      try {
        await recordDeletedAccountCleanupFailure({
          db: input.db,
          failureAttemptCount: claim.failureAttemptCount,
          failureCode: kind,
          now: passNow,
          userId: claim.id,
          workerId,
        })
      } catch {
        // The lease remains durable and can be recovered after expiry. Do not log account identity.
      }
    }
  }
  if (workQueue.length > 0) {
    await releaseDeletedAccountCleanupClaims({
      db: input.db,
      now: currentTime(),
      userIds: workQueue.map((claim) => claim.id),
      workerId,
    })
  }

  const pending = await input.db.user.count({
    where: {
      anonymizedAt: { not: null },
      deletionCleanupCompletedAt: null,
    },
  })
  const oldestPending = pending > 0
    ? await input.db.user.findFirst({
        where: {
          anonymizedAt: { not: null },
          deletionCleanupCompletedAt: null,
        },
        orderBy: [{ anonymizedAt: 'asc' }, { id: 'asc' }],
        select: { anonymizedAt: true },
      })
    : null
  const oldestPendingAt = oldestPending?.anonymizedAt ?? null
  const deferredFailureGroups = await input.db.user.groupBy({
    by: ['deletionCleanupLastFailureCode'],
    where: {
      anonymizedAt: { not: null },
      deletionCleanupCompletedAt: null,
      deletionCleanupLastFailureCode: { not: null },
    },
    _count: { deletionCleanupLastFailureCode: true },
  })
  const deferredFailures: Record<string, number> = Object.fromEntries(
    deferredFailureGroups.flatMap((group) => (
    group.deletionCleanupLastFailureCode
      ? [[
          group.deletionCleanupLastFailureCode,
          group._count.deletionCleanupLastFailureCode,
        ]]
      : []
    )),
  )

  return {
    accounts: accounts.size,
    deferredFailed: Object.values(deferredFailures).reduce((sum, count) => sum + count, 0),
    deferredFailures,
    failed,
    failures,
    hasMore: pending > 0,
    oldestPendingAt,
    overdue: oldestPendingAt !== null
      && input.now.getTime() - oldestPendingAt.getTime() >= accountDeletionCleanupSlaMs,
    pending,
    tenders,
  }
}

export async function claimDeletedAccountCleanupBatch(input: {
  db: DbClient
  limit: number
  now: Date
  workerId: string
}) {
  if (input.workerId.length === 0 || input.workerId.length > 64) {
    throw new Error('Account deletion cleanup worker id must contain 1 to 64 characters')
  }
  const limit = Math.max(1, Math.min(reconciliationBatchSize, Math.trunc(input.limit)))
  const leaseExpiresAt = new Date(input.now.getTime() + accountDeletionClaimLeaseMs)
  const claimed = await input.db.$transaction((transaction) => transaction.$queryRaw<Array<{
    failure_attempt_count: number
    id: string
  }>>`
    WITH candidates AS (
      SELECT "id"
      FROM "users"
      WHERE "anonymized_at" IS NOT NULL
        AND "deletion_cleanup_completed_at" IS NULL
        AND "deletion_cleanup_available_at" <= ${input.now}
        AND (
          "deletion_cleanup_lease_expires_at" IS NULL
          OR "deletion_cleanup_lease_expires_at" <= ${input.now}
        )
      ORDER BY "deletion_cleanup_available_at" ASC, "anonymized_at" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "users" AS account
    SET
      "deletion_cleanup_claim_owner" = ${input.workerId},
      "deletion_cleanup_lease_expires_at" = ${leaseExpiresAt}
    FROM candidates
    WHERE account."id" = candidates."id"
    RETURNING
      account."id"::text AS "id",
      account."deletion_cleanup_attempt_count" AS "failure_attempt_count"
  `)
  return claimed.map((claim) => ({
    failureAttemptCount: claim.failure_attempt_count,
    id: claim.id,
  }))
}

export async function reconcileDeletedAccount(
  input: {
    db: DbClient
    lifecycleSecret: string
    now: Date
    onTenderChanged?: (tenderId: string) => void | Promise<void>
    claimOwner?: string
  },
  userId: string,
) {
  for (let attempt = 0; attempt < reconciliationTransactionMaxAttempts; attempt += 1) {
    try {
      const result = await input.db.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, input.lifecycleSecret, userId)
        const account = await transaction.user.findFirst({
          where: {
            anonymizedAt: { not: null },
            deletionCleanupCompletedAt: null,
            id: userId,
            ...(input.claimOwner ? { deletionCleanupClaimOwner: input.claimOwner } : {}),
          },
          select: { deletionAuditPseudonym: true, id: true, login: true },
        })
        if (!account) return null

        await erasePrismaAccountIdentityInTransaction(transaction, {
          currentLogin: account.login,
          now: input.now,
          userId,
        })
        const roomBatch = await cleanupPrismaRoomBatchForAccountDeletion(transaction, userId)
        const tenderBatch = await anonymizePrismaTenderParticipantBatch(transaction, userId)
        await unlinkFeedbackAccountInTransaction(transaction, userId)
        const pseudonymousActorId = account.deletionAuditPseudonym ?? crypto.randomUUID()
        if (account.deletionAuditPseudonym === null) {
          await transaction.user.update({
            where: { id: userId },
            data: { deletionAuditPseudonym: pseudonymousActorId },
          })
        }
        const feedbackOperatorAuditBatch = await anonymizePrismaFeedbackOperatorActorBatch(
          transaction,
          {
            limit: operatorAuditActorCleanupBatchSize,
            pseudonymousActorId,
            userId,
          },
        )
        const mailOperatorAuditBatch = await anonymizePrismaMailOperatorActorBatch(transaction, {
          limit: operatorAuditActorCleanupBatchSize,
          pseudonymousActorId,
          userId,
        })
        const completed = !feedbackOperatorAuditBatch.hasMore
          && !mailOperatorAuditBatch.hasMore
          && !roomBatch.hasMore
          && !tenderBatch.hasMore
        if (completed) {
          await transaction.user.update({
            where: { id: userId },
            data: {
              deletionCleanupAttemptCount: 0,
              deletionCleanupAvailableAt: input.now,
              deletionCleanupClaimOwner: null,
              deletionCleanupCompletedAt: input.now,
              deletionCleanupLastFailureCode: null,
              deletionCleanupLeaseExpiresAt: null,
              deletionAuditPseudonym: null,
            },
          })
        } else if (input.claimOwner) {
          await transaction.user.update({
            where: { id: userId },
            data: {
              deletionCleanupAttemptCount: 0,
              deletionCleanupAvailableAt: input.now,
              deletionCleanupClaimOwner: input.claimOwner,
              deletionCleanupLastFailureCode: null,
              deletionCleanupLeaseExpiresAt: new Date(
                input.now.getTime() + accountDeletionClaimLeaseMs,
              ),
            },
          })
        }
        return {
          changedTenderIds: tenderBatch.changedTenderIds,
          completed,
        }
      }, {
        isolationLevel: 'Serializable',
        timeout: reconciliationTransactionTimeoutMs,
      })
      if (result && input.onTenderChanged) {
        for (const tenderId of result.changedTenderIds) {
          try {
            await input.onTenderChanged(tenderId)
          } catch {
            console.error('Account deletion Tender notification failed after cleanup commit.')
          }
        }
      }
      return result
    } catch (error) {
      if (
        !isRetryableReconciliationConflict(error)
        || attempt >= reconciliationTransactionMaxAttempts - 1
      ) throw error
      await new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)))
    }
  }

  throw new Error('Unreachable account deletion reconciliation retry state')
}

async function recordDeletedAccountCleanupFailure(input: {
  db: DbClient
  failureAttemptCount: number
  failureCode: ReconciliationFailureKind
  now: Date
  userId: string
  workerId: string
}) {
  const nextAttemptCount = input.failureAttemptCount + 1
  const retryDelayMs = Math.min(
    reconciliationFailureRetryMaxMs,
    reconciliationFailureRetryBaseMs * (2 ** Math.min(nextAttemptCount - 1, 9)),
  )
  return input.db.user.updateMany({
    where: {
      deletionCleanupClaimOwner: input.workerId,
      deletionCleanupCompletedAt: null,
      id: input.userId,
    },
    data: {
      deletionCleanupAttemptCount: { increment: 1 },
      deletionCleanupAvailableAt: new Date(input.now.getTime() + retryDelayMs),
      deletionCleanupClaimOwner: null,
      deletionCleanupLastFailureCode: input.failureCode,
      deletionCleanupLeaseExpiresAt: null,
    },
  })
}

async function releaseDeletedAccountCleanupClaims(input: {
  db: DbClient
  now: Date
  userIds: string[]
  workerId: string
}) {
  if (input.userIds.length === 0) return
  await input.db.user.updateMany({
    where: {
      deletionCleanupClaimOwner: input.workerId,
      deletionCleanupCompletedAt: null,
      id: { in: input.userIds },
    },
    data: {
      deletionCleanupAvailableAt: input.now,
      deletionCleanupClaimOwner: null,
      deletionCleanupLeaseExpiresAt: null,
    },
  })
}

function createMonotonicReconciliationClock(startedAt: Date) {
  const monotonicStartedAt = performance.now()
  let previous = startedAt.getTime()
  return () => {
    const elapsed = Math.max(0, Math.floor(performance.now() - monotonicStartedAt))
    previous = Math.max(previous + 1, startedAt.getTime() + elapsed)
    return new Date(previous)
  }
}

function isRetryableReconciliationConflict(error: unknown) {
  return error instanceof TenderVersionConflict
    || isRetryableDatabaseTransactionConflict(error)
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'P2025')
}

function classifyReconciliationFailure(error: unknown): ReconciliationFailureKind {
  if (error instanceof TenderVersionConflict || isRetryableDatabaseTransactionConflict(error)) {
    return 'database_conflict'
  }
  if (typeof error !== 'object' || error === null) return 'unexpected_failure'

  const code = 'code' in error && typeof error.code === 'string' ? error.code : null
  if (code === 'P2028') return 'transaction_timeout'
  if (code === 'P2025') return 'stale_reference'
  if (code?.startsWith('P')) return 'database_failure'
  if ('name' in error && error.name === 'ZodError') return 'legacy_data_invalid'
  return 'unexpected_failure'
}
