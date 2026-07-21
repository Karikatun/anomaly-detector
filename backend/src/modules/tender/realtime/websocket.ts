import type { Server, ServerWebSocket } from 'bun'

import type { RealtimeHub } from './hub'
import { consumeRealtimeTicket, type RealtimeTicketStore } from './tickets'

export type RealtimeSocketData = {
  playerId: string
  tenderId: string
  closeSubscription?: () => Promise<void>
}

export function createRealtimeWebSocketHandlers(input: {
  hub: RealtimeHub
}) {
  return {
    async open(ws: ServerWebSocket<RealtimeSocketData>) {
      const pending = ws.data
      const { playerId, tenderId } = pending
      try {
        const subscription = await input.hub.subscribe({
          playerId,
          socket: { send: (message) => { ws.send(message) } },
          tenderId,
        })
        pending.closeSubscription = () => subscription.close()
      } catch {
        ws.close(4403, 'Forbidden')
      }
    },
    async close(ws: ServerWebSocket<RealtimeSocketData>) {
      await ws.data.closeSubscription?.()
    },
    message() {
      // Clients do not send messages; commands go through the authenticated HTTP API.
    },
  }
}

export async function upgradeRealtimeWebSocket(input: {
  hub: RealtimeHub
  request: Request
  server: Server<RealtimeSocketData>
  ticketStore: RealtimeTicketStore
}): Promise<Response> {
  const url = new URL(input.request.url)
  const ticket = url.searchParams.get('ticket') ?? ''
  const tenderId = url.searchParams.get('tenderId') ?? ''
  try {
    const principal = await consumeRealtimeTicket({ store: input.ticketStore, ticket })
    const upgraded = input.server.upgrade(input.request, {
      data: { playerId: principal.userId, tenderId },
    })
    if (upgraded) return undefined as unknown as Response
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'WebSocket upgrade failed' } },
      { status: 400 },
    )
  } catch (failure) {
    const kind = failure instanceof Error && 'kind' in failure ? String(failure.kind) : 'realtime_ticket_invalid'
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: kind } },
      { status: 401 },
    )
  }
}
