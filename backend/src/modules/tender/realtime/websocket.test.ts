import { expect, spyOn, test } from 'bun:test'
import type { Server, ServerWebSocket } from 'bun'

import { TenderFailure } from '../domain/errors'
import { createTenderModule } from '../index'
import {
  createRealtimeHub,
  type RealtimeHub,
  type RealtimeSessionGuard,
  type RealtimeSubscription,
} from './hub'
import {
  createRealtimeWebSocketHandlers,
  upgradeRealtimeWebSocket,
  type RealtimeSocketData,
} from './websocket'
import type { RealtimeTicketStore } from './tickets'

const validTenderId = '00000000-0000-7000-8000-000000000001'

const upgradeRequest = (ticket: string) => new Request(
  `http://localhost/api/realtime/ws?ticket=${encodeURIComponent(ticket)}&tenderId=${validTenderId}`,
)

const asRealtimeServer = (upgrade: () => boolean) => ({
  upgrade,
}) as unknown as Server<RealtimeSocketData>

const alwaysActiveSessionGuard: RealtimeSessionGuard = {
  isActive: async () => true,
  runWhileActive: async (_principal, action) => {
    action()
    return true
  },
}

test('closes an operational subscription failure as a retryable internal error', async () => {
  const closeEvents: Array<{ code: number; reason: string }> = []
  const telemetryEvents: string[] = []
  const privateFailureDetail = 'database connection details must not reach logs or the client'
  const tender = {
    ...createTenderModule(),
    readTenderView: async () => {
      throw new Error(privateFailureDetail)
    },
  }
  const hub = createRealtimeHub({ sessionGuard: alwaysActiveSessionGuard, tender })
  const websocket = {
    close: (code: number, reason: string) => { closeEvents.push({ code, reason }) },
    data: {
      closed: false,
      metricsConnected: false,
      playerId: 'player-a',
      reconnect: true,
      sessionId: 'session-a',
      tenderId: '00000000-0000-4000-8000-000000000001',
    },
    send: () => undefined,
  } as unknown as ServerWebSocket<RealtimeSocketData>

  const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await createRealtimeWebSocketHandlers({
      hub,
      telemetry: {
        closed: () => telemetryEvents.push('closed'),
        connected: () => telemetryEvents.push('connected'),
      },
    }).open(websocket)

    expect(closeEvents).toEqual([{ code: 1011, reason: 'Internal error' }])
    expect(telemetryEvents).toEqual([])
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateFailureDetail)
  } finally {
    consoleError.mockRestore()
  }
})

test('records reconnect and close telemetry only after an authorised subscription succeeds', async () => {
  const events: Array<{ kind: 'connected'; reconnect: boolean } | { closeCode: number; kind: 'closed' }> = []
  const hub = {
    subscribe: async () => ({ close: async () => undefined }),
  } as unknown as RealtimeHub
  const websocket = {
    close: () => undefined,
    data: {
      closed: false,
      metricsConnected: false,
      playerId: 'player-a',
      reconnect: true,
      sessionId: 'session-a',
      tenderId: validTenderId,
    },
    send: () => undefined,
  } as unknown as ServerWebSocket<RealtimeSocketData>
  const handlers = createRealtimeWebSocketHandlers({
    hub,
    telemetry: {
      closed: (closeCode) => events.push({ closeCode, kind: 'closed' }),
      connected: (reconnect) => events.push({ kind: 'connected', reconnect }),
    },
  })

  await handlers.open(websocket)
  await handlers.close(websocket, 4401)
  await handlers.close(websocket, 4401)

  expect(events).toEqual([
    { kind: 'connected', reconnect: true },
    { closeCode: 4401, kind: 'closed' },
  ])
})

test('parses only the bounded reconnect marker into upgraded socket telemetry data', async () => {
  const upgradedData: RealtimeSocketData[] = []
  const server = {
    upgrade: (_request: Request, options: { data: RealtimeSocketData }) => {
      upgradedData.push(options.data)
      return true
    },
  } as unknown as Server<RealtimeSocketData>
  const store: RealtimeTicketStore = {
    consume: async () => ({
      kind: 'consumed',
      sessionId: 'session-a',
      userId: 'player-a',
    }),
  }

  await upgradeRealtimeWebSocket({
    hub: {} as RealtimeHub,
    request: new Request(`${upgradeRequest('ticket').url}&reconnect=1`),
    server,
    ticketStore: store,
  })
  await upgradeRealtimeWebSocket({
    hub: {} as RealtimeHub,
    request: new Request(`${upgradeRequest('ticket').url}&reconnect=private-user-input`),
    server,
    ticketStore: store,
  })

  expect(upgradedData.map((data) => data.reconnect)).toEqual([true, false])
})

test.each([
  {
    name: 'ticket lookup',
    store: {
      consume: async () => { throw new Error('database unavailable') },
    } satisfies RealtimeTicketStore,
    upgrade: () => true,
  },
  {
    name: 'server upgrade',
    store: {
      consume: async () => ({
        kind: 'consumed' as const,
        sessionId: 'session-a',
        userId: 'player-a',
      }),
    } satisfies RealtimeTicketStore,
    upgrade: () => { throw new Error('upgrade capacity unavailable') },
  },
])('returns a logged redacted 503 for an unexpected $name failure', async ({ store, upgrade }) => {
  const ticket = 'raw-ticket-must-not-be-logged'
  const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const response = await upgradeRealtimeWebSocket({
      hub: {} as RealtimeHub,
      request: upgradeRequest(ticket),
      server: asRealtimeServer(upgrade),
      ticketStore: store,
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Realtime service is unavailable' },
    })
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(ticket)
  } finally {
    consoleError.mockRestore()
  }
})

test('keeps an unknown realtime ticket before socket upgrade and telemetry', async () => {
  let upgradeCalls = 0
  const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const response = await upgradeRealtimeWebSocket({
      hub: {} as RealtimeHub,
      request: upgradeRequest('unknown-ticket'),
      server: asRealtimeServer(() => {
        upgradeCalls += 1
        return true
      }),
      ticketStore: { consume: async () => ({ kind: 'not_found' }) },
    })
    expect(upgradeCalls).toBe(0)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'realtime_ticket_invalid' },
    })
    expect(consoleError).not.toHaveBeenCalled()
  } finally {
    consoleError.mockRestore()
  }
})

test.each([
  'tender_not_found',
  'player_not_in_tender',
  'player_forfeited',
] as const)('conceals %s with the dedicated terminal close code', async (kind) => {
  const closeEvents: Array<{ code: number; reason: string }> = []
  const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const hub = createRealtimeHub({
      sessionGuard: alwaysActiveSessionGuard,
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
        sessionId: 'session-a',
        tenderId: '00000000-0000-4000-8000-000000000001',
      },
      send: () => undefined,
    } as unknown as ServerWebSocket<RealtimeSocketData>

    await createRealtimeWebSocketHandlers({ hub }).open(websocket)

    expect(closeEvents).toEqual([{ code: 4404, reason: 'Unavailable' }])
    expect(consoleError).not.toHaveBeenCalled()
  } finally {
    consoleError.mockRestore()
  }
})

test('closes an excess player subscription with a retryable capacity code', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  const hub = createRealtimeHub({ sessionGuard: alwaysActiveSessionGuard, tender })
  for (let index = 0; index < 10; index += 1) {
    await hub.subscribe({
      playerId: 'player-a',
      sessionId: `session-${index}`,
      socket: { close: () => undefined, send: () => undefined },
      tenderId,
    })
  }
  const closeEvents: Array<{ code: number; reason: string }> = []
  const websocket = {
    close: (code: number, reason: string) => { closeEvents.push({ code, reason }) },
    data: {
      closed: false,
      playerId: 'player-a',
      sessionId: 'session-overflow',
      tenderId,
    },
    send: () => undefined,
  } as unknown as ServerWebSocket<RealtimeSocketData>

  await createRealtimeWebSocketHandlers({ hub }).open(websocket)

  expect(closeEvents).toEqual([{ code: 4429, reason: 'Try again later' }])
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
      sessionId: 'session-a',
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
