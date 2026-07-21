import { describe, expect, test } from 'bun:test'

import { consumeRealtimeTicket, hashRealtimeTicket, type RealtimeTicketStore } from './tickets'

const storeWith = (result: Awaited<ReturnType<RealtimeTicketStore['consume']>>): RealtimeTicketStore => ({
  consume: async () => result,
})

describe('realtime ticket exchange', () => {
  test('accepts a valid one-time ticket and exposes its bound session', async () => {
    const consumed: Array<{ now: Date; ticketHash: string }> = []
    const store: RealtimeTicketStore = {
      consume: async (input) => {
        consumed.push(input)
        return { kind: 'consumed', sessionId: 'session-1', userId: 'user-1' }
      },
    }

    await expect(consumeRealtimeTicket({ store, ticket: 'raw-ticket' })).resolves.toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
    })
    expect(consumed).toHaveLength(1)
    expect(consumed[0].ticketHash).toBe(hashRealtimeTicket('raw-ticket'))
  })

  test('rejects an unknown ticket', async () => {
    await expect(consumeRealtimeTicket({
      store: storeWith({ kind: 'not_found' }),
      ticket: 'missing',
    })).rejects.toMatchObject({ kind: 'realtime_ticket_invalid' })
  })

  test('rejects an already used ticket', async () => {
    await expect(consumeRealtimeTicket({
      store: storeWith({ kind: 'used' }),
      ticket: 'replayed',
    })).rejects.toMatchObject({ kind: 'realtime_ticket_used' })
  })

  test('rejects an expired ticket', async () => {
    await expect(consumeRealtimeTicket({
      store: storeWith({ kind: 'expired' }),
      ticket: 'stale',
    })).rejects.toMatchObject({ kind: 'realtime_ticket_expired' })
  })
})
