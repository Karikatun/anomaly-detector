import { createHash } from 'node:crypto'

import { RealtimeFailure, type RealtimePrincipal } from './errors'

export type RealtimeTicketStore = {
  consume(input: { now: Date; ticketHash: string }): Promise<
    | { kind: 'consumed'; sessionId: string; userId: string }
    | { kind: 'expired' }
    | { kind: 'not_found' }
    | { kind: 'used' }
  >
}

export type RealtimeTicketIssuer = {
  issue(input: {
    expiresAt: Date
    now: Date
    sessionId: string
    ticketHash: string
    userId: string
  }): Promise<void>
}

export function hashRealtimeTicket(ticket: string) {
  return createHash('sha256').update(ticket).digest('hex')
}

export async function consumeRealtimeTicket(input: {
  now?: Date
  store: RealtimeTicketStore
  ticket: string
}): Promise<RealtimePrincipal> {
  const result = await input.store.consume({
    now: input.now ?? new Date(),
    ticketHash: hashRealtimeTicket(input.ticket),
  })
  if (result.kind === 'not_found') {
    throw new RealtimeFailure('realtime_ticket_invalid', 'Realtime ticket is unknown')
  }
  if (result.kind === 'used') {
    throw new RealtimeFailure('realtime_ticket_used', 'Realtime ticket was already used')
  }
  if (result.kind === 'expired') {
    throw new RealtimeFailure('realtime_ticket_expired', 'Realtime ticket has expired')
  }
  return { sessionId: result.sessionId, userId: result.userId }
}
