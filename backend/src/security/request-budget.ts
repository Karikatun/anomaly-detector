import { createHmac } from 'node:crypto'

import type { DbClient } from '../db'
import { isRequestBudgetScope, type RequestBudgetPolicy } from './request-budget-policy'

export type RequestBudget = {
  consume(input: {
    key: string
    now: Date
    policy: RequestBudgetPolicy
  }): Promise<{
    allowed: boolean
    retryAfterSeconds: number
  }>
}

export function createPrismaRequestBudget(db: DbClient, secret: string): RequestBudget {
  if (secret.length < 32) {
    throw new Error('Request budget HMAC secret must contain at least 32 characters')
  }

  return {
    async consume(input) {
      const { policy } = input
      if (!isRequestBudgetScope(policy.scope)) {
        throw new Error('Request budget scope is not allowlisted')
      }
      const keyHash = createHmac('sha256', secret)
        .update('request-budget-v1\0')
        .update(policy.scope)
        .update('\0')
        .update(input.key)
        .digest('hex')

      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${policy.scope}:${keyHash}`}, 0))::text AS "lock"`
        const existing = await tx.authAbuseBucket.findUnique({
          where: { scope_keyHash: { keyHash, scope: policy.scope } },
        })
        const windowExpired = !existing || existing.expiresAt <= input.now
        const count = windowExpired ? 1 : Math.min(existing.count + 1, policy.limit + 1)
        const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
        const expiresAt = new Date(windowStartedAt.getTime() + policy.windowMs)

        await tx.authAbuseBucket.upsert({
          where: { scope_keyHash: { keyHash, scope: policy.scope } },
          create: {
            blockedUntil: null,
            count,
            expiresAt,
            keyHash,
            scope: policy.scope,
            windowStartedAt,
          },
          update: {
            blockedUntil: null,
            count,
            expiresAt,
            windowStartedAt,
          },
        })

        return {
          allowed: count <= policy.limit,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((expiresAt.getTime() - input.now.getTime()) / 1_000),
          ),
        }
      })
    },
  }
}
