import type { DbClient } from '../../../db'
import type { RealtimeTicketIssuer } from './tickets'

export function createPrismaRealtimeTicketIssuer(db: DbClient): RealtimeTicketIssuer {
  return {
    issue(input) {
      return db.$transaction(async (tx) => {
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
      })
    },
  }
}
