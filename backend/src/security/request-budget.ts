import { createHash } from 'node:crypto'

import type { DbClient } from '../db'

export type RequestBudget = {
  consume(input: {
    key: string
    limit: number
    now: Date
    scope: string
    windowMs: number
  }): Promise<{
    allowed: boolean
    retryAfterSeconds: number
  }>
}

export function createPrismaRequestBudget(db: DbClient): RequestBudget {
  return {
    async consume(input) {
      const keyHash = createHash('sha256')
        .update(`request-budget:${input.scope}:${input.key}`)
        .digest('hex')

      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.scope}:${keyHash}`}, 0))::text AS "lock"`
        const existing = await tx.authAbuseBucket.findUnique({
          where: { scope_keyHash: { keyHash, scope: input.scope } },
        })
        const windowExpired = !existing || existing.expiresAt <= input.now
        const count = windowExpired ? 1 : existing.count + 1
        const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
        const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs)

        await tx.authAbuseBucket.upsert({
          where: { scope_keyHash: { keyHash, scope: input.scope } },
          create: {
            blockedUntil: null,
            count,
            expiresAt,
            keyHash,
            scope: input.scope,
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
          allowed: count <= input.limit,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((expiresAt.getTime() - input.now.getTime()) / 1_000),
          ),
        }
      })
    },
  }
}
