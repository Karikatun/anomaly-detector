import type { DbClient } from '../../../db'
import type { RealtimeTicketStore } from './tickets'

const dayMs = 24 * 60 * 60 * 1_000

export function createPrismaRealtimeTicketStore(
  db: DbClient,
  input: { sessionAbsoluteTtlDays: number },
): RealtimeTicketStore {
  return {
    async consume({ now, ticketHash }) {
      const sessionCreatedAfter = new Date(now.getTime() - input.sessionAbsoluteTtlDays * dayMs)
      return db.$transaction(async (tx) => {
        const ticket = await tx.realtimeTicket.findUnique({
          where: { ticketHash },
          include: {
            session: {
              select: {
                createdAt: true,
                expiresAt: true,
                revokedAt: true,
                userId: true,
              },
            },
          },
        })
        if (!ticket) return { kind: 'not_found' as const }
        if (ticket.usedAt !== null) return { kind: 'used' as const }
        if (ticket.expiresAt <= now) return { kind: 'expired' as const }
        if (
          ticket.session.userId !== ticket.userId
          || ticket.session.revokedAt !== null
          || ticket.session.expiresAt <= now
          || ticket.session.createdAt <= sessionCreatedAfter
        ) {
          return { kind: 'not_found' as const }
        }
        const consumed = await tx.realtimeTicket.updateMany({
          data: { usedAt: now },
          where: {
            ticketHash,
            usedAt: null,
            session: {
              is: {
                expiresAt: { gt: now },
                revokedAt: null,
                createdAt: { gt: sessionCreatedAfter },
                userId: ticket.userId,
              },
            },
          },
        })
        if (consumed.count === 0) return { kind: 'not_found' as const }
        return { kind: 'consumed' as const, sessionId: ticket.sessionId, userId: ticket.userId }
      })
    },
  }
}
