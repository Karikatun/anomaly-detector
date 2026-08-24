import type { Server, ServerWebSocket } from 'bun'
import { tenderResourceIdSchema } from '@anomaly-detector/contracts'

import {
  resolveRealtimeFailureClose,
  type RealtimeHub,
} from './hub'
import { consumeRealtimeTicket, type RealtimeTicketStore } from './tickets'

export type RealtimeSocketData = {
  closed: boolean
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
          socket: {
            close: (code, reason) => { ws.close(code, reason) },
            send: (message) => { ws.send(message) },
          },
          tenderId,
        })
        if (pending.closed) {
          await subscription.close()
          return
        }
        pending.closeSubscription = () => subscription.close()
      } catch (failure) {
        if (pending.closed) return
        const failureClose = resolveRealtimeFailureClose(failure)
        ws.close(failureClose.code, failureClose.reason)
      }
    },
    async close(ws: ServerWebSocket<RealtimeSocketData>) {
      const pending = ws.data
      pending.closed = true
      const closeSubscription = pending.closeSubscription
      pending.closeSubscription = undefined
      await closeSubscription?.()
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
  if (!tenderResourceIdSchema.safeParse(tenderId).success) {
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid Tender id' } },
      { status: 400 },
    )
  }
  try {
    const principal = await consumeRealtimeTicket({ store: input.ticketStore, ticket })
    const upgraded = input.server.upgrade(input.request, {
      data: { closed: false, playerId: principal.userId, tenderId },
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
