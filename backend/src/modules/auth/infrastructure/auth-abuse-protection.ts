import { createHmac } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import type { AuthAbuseProtection } from '../application/ports'
import { AuthFailure } from '../domain/errors'

const loginWindowMs = 15 * 60 * 1_000
const loginFailureLimit = 5
const loginBackoffBaseMs = 30 * 1_000
const loginBackoffMaxMs = 15 * 60 * 1_000
const loginIpAttemptLimit = 30

export function createPrismaAuthAbuseProtection(
  db: DbClient,
  secret: string,
): AuthAbuseProtection {
  const hashKey = (scope: string, value: string) =>
    createHmac('sha256', secret).update(`auth-abuse:${scope}:${value}`).digest('hex')

  return {
    async beginLoginAttempt({ ipAddress = 'unknown', login, now }) {
      const loginKeyHash = hashKey('login', login)
      const bucket = await db.authAbuseBucket.findUnique({
        where: { scope_keyHash: { scope: 'login_failure', keyHash: loginKeyHash } },
      })
      if (bucket?.blockedUntil && bucket.blockedUntil > now) {
        throw new AuthFailure('login_throttled', 'Invalid login or password. Try again later.')
      }

      const ipKeyHash = hashKey('ip', ipAddress)
      const count = await updateBucket(db, {
        keyHash: ipKeyHash,
        now,
        scope: 'login_ip_attempt',
        windowMs: loginWindowMs,
      })
      if (count > loginIpAttemptLimit) {
        throw new AuthFailure('login_throttled', 'Invalid login or password. Try again later.')
      }
    },

    async recordLoginFailure({ login, now }) {
      const count = await updateBucket(db, {
        blockedUntilForCount: (nextCount) => {
          if (nextCount < loginFailureLimit) return null
          const multiplier = 2 ** Math.max(0, nextCount - loginFailureLimit)
          return new Date(now.getTime() + Math.min(loginBackoffMaxMs, loginBackoffBaseMs * multiplier))
        },
        keyHash: hashKey('login', login),
        now,
        scope: 'login_failure',
        windowMs: loginWindowMs,
      })
      return { limited: count > loginFailureLimit }
    },

    async recordLoginSuccess({ login }) {
      await db.authAbuseBucket.deleteMany({
        where: {
          scope: 'login_failure',
          keyHash: hashKey('login', login),
        },
      })
    },
  }
}

async function updateBucket(
  db: DbClient,
  input: {
    blockedUntilForCount?: (count: number) => Date | null
    keyHash: string
    now: Date
    scope: string
    windowMs: number
  },
) {
  return withBucketLock(db, `${input.scope}:${input.keyHash}`, async (tx) => {
    const existing = await tx.authAbuseBucket.findUnique({
      where: { scope_keyHash: { scope: input.scope, keyHash: input.keyHash } },
    })
    const windowExpired = !existing || existing.expiresAt <= input.now
    const count = windowExpired ? 1 : existing.count + 1
    const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
    const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs)
    const blockedUntil = input.blockedUntilForCount?.(count) ?? null

    await tx.authAbuseBucket.upsert({
      where: { scope_keyHash: { scope: input.scope, keyHash: input.keyHash } },
      create: {
        blockedUntil,
        count,
        expiresAt,
        keyHash: input.keyHash,
        scope: input.scope,
        windowStartedAt,
      },
      update: {
        blockedUntil,
        count,
        expiresAt,
        windowStartedAt,
      },
    })
    return count
  })
}

async function withBucketLock<T>(
  db: DbClient,
  lockKey: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"`
    return operation(tx)
  })
}
