import type { Server, ServerWebSocket } from 'bun'
import { tenderResourceIdSchema } from '@anomaly-detector/contracts'

import {
  resolveRealtimeFailureClose,
  type RealtimeHub,
} from './hub'
import { RealtimeFailure, type RealtimePrincipal } from './errors'
import { consumeRealtimeTicket, type RealtimeTicketStore } from './tickets'

export type RealtimeSocketData = {
  closed: boolean
  playerId: string
  sessionId: string
  tenderId: string
  closeSubscription?: () => Promise<void>
}

const knownTicketFailure = (failure: unknown): failure is RealtimeFailure =>
  failure instanceof RealtimeFailure && (
    failure.kind === 'realtime_ticket_expired'
    || failure.kind === 'realtime_ticket_invalid'
    || failure.kind === 'realtime_ticket_used'
  )

const unavailableRealtimeResponse = (context: string) => {
  console.error(context)
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Realtime service is unavailable' } },
    { status: 503 },
  )
}

export function createRealtimeWebSocketHandlers(input: {
  hub: RealtimeHub
}) {
  return {
    async open(ws: ServerWebSocket<RealtimeSocketData>) {
      const pending = ws.data
      const { playerId, sessionId, tenderId } = pending
      try {
        const subscription = await input.hub.subscribe({
          playerId,
          sessionId,
          socket: {
            close: (code, reason) => {
              if (pending.closed) return
              pending.closed = true
              ws.close(code, reason)
            },
            send: (message) => {
              if (!pending.closed) ws.send(message)
            },
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
        if (failureClose.reportAsError) {
          console.error('Realtime WebSocket subscription failed')
        }
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
  let principal: RealtimePrincipal
  try {
    principal = await consumeRealtimeTicket({ store: input.ticketStore, ticket })
  } catch (failure) {
    if (knownTicketFailure(failure)) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: failure.kind } },
        { status: 401 },
      )
    }
    return unavailableRealtimeResponse('Realtime WebSocket ticket lookup failed')
  }

  try {
    const upgraded = input.server.upgrade(input.request, {
      data: {
        closed: false,
        playerId: principal.userId,
        sessionId: principal.sessionId,
        tenderId,
      },
    })
    if (upgraded) return undefined as unknown as Response
    return Response.json(
      { error: { code: 'BAD_REQUEST', message: 'WebSocket upgrade failed' } },
      { status: 400 },
    )
  } catch {
    return unavailableRealtimeResponse('Realtime WebSocket upgrade failed')
  }
}
