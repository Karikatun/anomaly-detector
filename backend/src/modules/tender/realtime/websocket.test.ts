import { expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'

import { TenderFailure } from '../domain/errors'
import { createTenderModule } from '../index'
import {
  createRealtimeHub,
  type RealtimeHub,
  type RealtimeSubscription,
} from './hub'
import {
  createRealtimeWebSocketHandlers,
  type RealtimeSocketData,
} from './websocket'

test('closes an operational subscription failure as a retryable internal error', async () => {
  const closeEvents: Array<{ code: number; reason: string }> = []
  const tender = {
    ...createTenderModule(),
    readTenderView: async () => {
      throw new Error('database connection details must not reach the client')
    },
  }
  const hub = createRealtimeHub({ tender })
  const websocket = {
    close: (code: number, reason: string) => { closeEvents.push({ code, reason }) },
    data: {
      closed: false,
      playerId: 'player-a',
      tenderId: '00000000-0000-4000-8000-000000000001',
    },
    send: () => undefined,
  } as unknown as ServerWebSocket<RealtimeSocketData>

  await createRealtimeWebSocketHandlers({ hub }).open(websocket)

  expect(closeEvents).toEqual([{ code: 1011, reason: 'Internal error' }])
})

test.each([
  'tender_not_found',
  'player_not_in_tender',
  'player_forfeited',
] as const)('conceals %s with the dedicated terminal close code', async (kind) => {
  const closeEvents: Array<{ code: number; reason: string }> = []
  const hub = createRealtimeHub({
    tender: {
      ...createTenderModule(),
      readTenderView: async () => {
        throw new TenderFailure(kind, 'private failure detail')
      },
    },
  })
  const websocket = {
    close: (code: number, reason: string) => { closeEvents.push({ code, reason }) },
    data: {
      closed: false,
      playerId: 'player-a',
      tenderId: '00000000-0000-4000-8000-000000000001',
    },
    send: () => undefined,
  } as unknown as ServerWebSocket<RealtimeSocketData>

  await createRealtimeWebSocketHandlers({ hub }).open(websocket)

  expect(closeEvents).toEqual([{ code: 4404, reason: 'Unavailable' }])
})

test('cleans up exactly once when the socket closes while subscription setup is pending', async () => {
  let cleanupCalls = 0
  let resolveSubscription!: (subscription: RealtimeSubscription) => void
  const subscription = new Promise<RealtimeSubscription>((resolve) => {
    resolveSubscription = resolve
  })
  const hub = {
    subscribe: async () => subscription,
  } as unknown as RealtimeHub
  const websocket = {
    close: () => undefined,
    data: {
      closed: false,
      playerId: 'player-a',
      tenderId: '00000000-0000-4000-8000-000000000001',
    },
    send: () => undefined,
  } as unknown as ServerWebSocket<RealtimeSocketData>
  const handlers = createRealtimeWebSocketHandlers({ hub })

  const opening = handlers.open(websocket)
  await Promise.resolve()
  await handlers.close(websocket)
  resolveSubscription({
    close: async () => { cleanupCalls += 1 },
  })
  await opening

  expect(cleanupCalls).toBe(1)
  await handlers.close(websocket)
  expect(cleanupCalls).toBe(1)
})
