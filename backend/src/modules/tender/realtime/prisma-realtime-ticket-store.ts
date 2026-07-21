import type { DbClient } from '../../../db'
import type { RealtimeTicketStore } from './tickets'

export function createPrismaRealtimeTicketStore(db: DbClient): RealtimeTicketStore {
  return {
    async consume({ now, ticketHash }) {
      return db.$transaction(async (tx) => {
        const ticket = await tx.realtimeTicket.findUnique({ where: { ticketHash } })
        if (!ticket) return { kind: 'not_found' as const }
        if (ticket.usedAt !== null) return { kind: 'used' as const }
        if (ticket.expiresAt <= now) return { kind: 'expired' as const }
        const consumed = await tx.realtimeTicket.updateMany({
          data: { usedAt: now },
          where: { ticketHash, usedAt: null },
        })
        if (consumed.count === 0) return { kind: 'used' as const }
        return { kind: 'consumed' as const, sessionId: ticket.sessionId, userId: ticket.userId }
      })
    },
  }
}
