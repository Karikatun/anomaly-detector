import { createHash } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { RealtimeTicketIssuer } from './tickets'

const ticketIssueLimit = 10
const ticketIssueWindowMs = 60_000
const ticketIssueScope = 'realtime_ticket_issue'

export function createPrismaRealtimeTicketIssuer(db: DbClient): RealtimeTicketIssuer {
  return {
    issue(input) {
      const keyHash = createHash('sha256').update(input.userId).digest('hex')
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${ticketIssueScope}:${keyHash}`}, 0))::text AS "lock"`
        const existing = await tx.authAbuseBucket.findUnique({
          where: {
            scope_keyHash: {
              keyHash,
              scope: ticketIssueScope,
            },
          },
        })
        const windowExpired = !existing || existing.expiresAt <= input.now
        const count = windowExpired ? 1 : existing.count + 1
        const windowStartedAt = windowExpired ? input.now : existing.windowStartedAt
        const windowExpiresAt = new Date(windowStartedAt.getTime() + ticketIssueWindowMs)

        await tx.authAbuseBucket.upsert({
          where: {
            scope_keyHash: {
              keyHash,
              scope: ticketIssueScope,
            },
          },
          create: {
            blockedUntil: null,
            count,
            expiresAt: windowExpiresAt,
            keyHash,
            scope: ticketIssueScope,
            windowStartedAt,
          },
          update: {
            blockedUntil: null,
            count,
            expiresAt: windowExpiresAt,
            windowStartedAt,
          },
        })

        if (count > ticketIssueLimit) {
          return {
            kind: 'limited' as const,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((windowExpiresAt.getTime() - input.now.getTime()) / 1_000),
            ),
          }
        }

        await tx.realtimeTicket.deleteMany({
          where: {
            userId: input.userId,
            OR: [
              { expiresAt: { lte: input.now } },
              { usedAt: { not: null } },
            ],
          },
        })
        await tx.realtimeTicket.create({
          data: {
            expiresAt: input.expiresAt,
            sessionId: input.sessionId,
            ticketHash: input.ticketHash,
            userId: input.userId,
          },
        })
        return { kind: 'issued' as const }
      })
    },
  }
}
