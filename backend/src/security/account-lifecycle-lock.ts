import { createHash } from 'node:crypto'

import type { DbTransaction } from '../db'

export async function lockAccountLifecycleTransaction(
  transaction: DbTransaction,
  _accountLifecycleSecret: string,
  userId: string,
) {
  // Compatible revisions can briefly use different JWT generations during a
  // rotation, so this lock cannot live in the JWT-keyed namespace. The UUID
  // stays out of the advisory-lock value, and the versioned domain separator
  // keeps this namespace distinct from other locks. The legacy keyed namespace
  // still requires the rollout's documented stop-and-drain boundary.
  const key = createHash('sha256')
    .update('account-lifecycle-lock:v1\0')
    .update(userId)
    .digest('hex')
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"
  `
}

export async function lockActiveAccountLifecycleTransaction(
  transaction: DbTransaction,
  secret: string,
  userId: string,
) {
  await lockAccountLifecycleTransaction(transaction, secret, userId)
  const activeUsers = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "users"
    WHERE "id" = ${userId}::uuid
      AND "anonymized_at" IS NULL
    FOR UPDATE
  `
  return activeUsers.length === 1
}
