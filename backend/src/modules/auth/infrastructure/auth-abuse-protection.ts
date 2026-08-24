import { createHmac } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import type { AuthAbuseProtection } from '../application/ports'
import { AuthFailure } from '../domain/errors'
import {
  createRequestBudgetPolicyCatalog,
  type RequestBudgetPolicyCatalog,
} from '../../../security/request-budget-policy'

const loginBackoffBaseMs = 30 * 1_000
const loginBackoffMaxMs = 15 * 60 * 1_000

export function createPrismaAuthAbuseProtection(
  db: DbClient,
  secret: string,
  policies: RequestBudgetPolicyCatalog = createRequestBudgetPolicyCatalog(),
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
        throw new AuthFailure(
          'login_throttled',
          'Invalid login or password. Try again later.',
          retryAfterSeconds(bucket.blockedUntil, now),
        )
      }

      const ipKeyHash = hashKey('ip', ipAddress)
      const ipBucket = await updateBucket(db, {
        keyHash: ipKeyHash,
        maximumCount: policies.login_ip_attempt.limit + 1,
        now,
        scope: 'login_ip_attempt',
        windowMs: policies.login_ip_attempt.windowMs,
      })
      if (ipBucket.count > policies.login_ip_attempt.limit) {
        throw new AuthFailure(
          'login_throttled',
          'Invalid login or password. Try again later.',
          retryAfterSeconds(ipBucket.expiresAt, now),
        )
      }
    },

    async recordLoginFailure({ login, now }) {
      const bucket = await updateBucket(db, {
        blockedUntilForCount: (nextCount) => {
          if (nextCount < policies.login_failure.limit) return null
          const multiplier = 2 ** Math.max(0, nextCount - policies.login_failure.limit)
          return new Date(now.getTime() + Math.min(loginBackoffMaxMs, loginBackoffBaseMs * multiplier))
        },
        keyHash: hashKey('login', login),
        maximumCount: policies.login_failure.limit + 5,
        now,
        scope: 'login_failure',
        windowMs: policies.login_failure.windowMs,
      })
      return {
        limited: bucket.count > policies.login_failure.limit,
        ...(bucket.blockedUntil
          ? { retryAfterSeconds: retryAfterSeconds(bucket.blockedUntil, now) }
          : {}),
      }
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
    maximumCount?: number
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
    const nextCount = windowExpired ? 1 : existing.count + 1
    const count = Math.min(nextCount, input.maximumCount ?? Number.MAX_SAFE_INTEGER)
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
    return { blockedUntil, count, expiresAt }
  })
}

function retryAfterSeconds(expiresAt: Date, now: Date) {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000))
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
