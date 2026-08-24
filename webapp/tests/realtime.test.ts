import { expect, test } from 'bun:test'

import { ApiRequestError, type AuthenticatedTransport } from '../src/platform/api'
import { TenderRealtimeSession, type RealtimeState } from '../src/features/tender/realtime'

test('stopped realtime session never opens a socket after its ticket arrives', async () => {
  let resolveTicket!: (value: { expiresAt: string; ticket: string }) => void
  const ticket = new Promise<{ expiresAt: string; ticket: string }>((resolve) => {
    resolveTicket = resolve
  })
  const openedUrls: string[] = []
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'http://api.test',
    createSocket: (url) => {
      openedUrls.push(url)
      return new FakeSocket()
    },
    onState: () => undefined,
    scheduleReconnect: () => 1,
    cancelReconnect: () => undefined,
    tenderId: 'tender-a',
    transport: {
      request: async () => ticket,
    } as AuthenticatedTransport,
  })

  session.start()
  session.stop()
  resolveTicket({
    expiresAt: '2026-07-25T00:00:00.000Z',
    ticket: 'ticket-ticket-ticket-ticket-ticket-123',
  })
  await ticket
  await Promise.resolve()

  expect(openedUrls).toEqual([])
})

test('realtime sessions bind updates to their own Tender lifecycle', async () => {
  const states: RealtimeState[] = []
  const sockets: Array<{ url: string; socket: FakeSocket }> = []
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: (url) => {
      const socket = new FakeSocket()
      sockets.push({ url, socket })
      return socket
    },
    onState: (state) => states.push(state),
    scheduleReconnect: () => 1,
    cancelReconnect: () => undefined,
    tenderId: 'tender-b',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await Promise.resolve()
  await Promise.resolve()

  expect(sockets).toHaveLength(1)
  expect(sockets[0]?.url).toContain('tenderId=tender-b')

  session.stop()
  sockets[0]?.socket.emitOpen()

  expect(states.at(-1)).toEqual({
    connected: false,
    error: null,
    tenderView: null,
  })
})

test('an active realtime session reports stale state and schedules recovery after disconnect', async () => {
  const states: RealtimeState[] = []
  const sockets: FakeSocket[] = []
  let reconnect: (() => void) | null = null
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    onState: (state) => states.push(state),
    scheduleReconnect: (callback) => {
      reconnect = callback
      return 1
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-c',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await Promise.resolve()
  await Promise.resolve()
  sockets[0]?.emitOpen()
  sockets[0]?.emitClose()

  expect(states.at(-1)?.connected).toBe(false)
  expect(reconnect).not.toBeNull()
})

test('a dedicated concealed Tender rejection becomes terminal and does not reconnect', async () => {
  const states: RealtimeState[] = []
  const socket = new FakeSocket()
  let reconnectScheduled = false
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => socket,
    onState: (state) => states.push(state),
    scheduleReconnect: () => {
      reconnectScheduled = true
      return 1
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-concealed',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await flushMicrotasks()
  socket.emitOpen()
  socket.emitClose(4404)

  expect(states.at(-1)).toEqual({
    connected: false,
    error: 'access-denied',
    tenderView: null,
  })
  expect(reconnectScheduled).toBeFalse()
})

test('a legacy ambiguous 4403 close stays retryable during backend rollback', async () => {
  const states: RealtimeState[] = []
  const socket = new FakeSocket()
  let reconnectScheduled = false
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => socket,
    onState: (state) => states.push(state),
    scheduleReconnect: () => {
      reconnectScheduled = true
      return 1
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-legacy-ambiguous',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await flushMicrotasks()
  socket.emitOpen()
  socket.emitClose(4403)

  expect(states.at(-1)).toEqual({
    connected: false,
    error: null,
    tenderView: null,
  })
  expect(states.some((state) => state.error === 'access-denied')).toBeFalse()
  expect(reconnectScheduled).toBeTrue()
})

test('an operational realtime close stays retryable and is not reported as access denied', async () => {
  const states: RealtimeState[] = []
  const socket = new FakeSocket()
  let reconnectScheduled = false
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => socket,
    onState: (state) => states.push(state),
    scheduleReconnect: () => {
      reconnectScheduled = true
      return 1
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-operational-failure',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await flushMicrotasks()
  socket.emitOpen()
  socket.emitClose(1011)

  expect(states.at(-1)).toEqual({
    connected: false,
    error: null,
    tenderView: null,
  })
  expect(states.some((state) => state.error === 'access-denied')).toBeFalse()
  expect(reconnectScheduled).toBeTrue()
})

test('two tabs stay within the shared ten-ticket budget during continuous failure', async () => {
  let nowMs = 0
  const requestTimes: number[] = []
  const scheduled: Array<{ callback: () => void; dueAtMs: number }> = []
  const options = () => ({
    apiBaseUrl: 'https://api.test',
    createSocket: () => new FakeSocket(),
    onState: () => undefined,
    scheduleReconnect: (callback: () => void, delayMs: number) => {
      scheduled.push({ callback, dueAtMs: nowMs + delayMs })
      return scheduled.length
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-shared-budget',
    transport: {
      request: async () => {
        requestTimes.push(nowMs)
        throw new Error('ticket endpoint unavailable')
      },
    } as AuthenticatedTransport,
  })
  const firstTab = new TenderRealtimeSession(options())
  const secondTab = new TenderRealtimeSession(options())

  firstTab.start()
  secondTab.start()
  await flushMicrotasks()

  while (true) {
    const nextDueAtMs = Math.min(...scheduled.map((timer) => timer.dueAtMs))
    if (!Number.isFinite(nextDueAtMs) || nextDueAtMs >= 60_000) break

    nowMs = nextDueAtMs
    const dueTimers = scheduled.filter((timer) => timer.dueAtMs === nowMs)
    for (const timer of dueTimers) {
      scheduled.splice(scheduled.indexOf(timer), 1)
      timer.callback()
    }
    await flushMicrotasks()
  }

  expect(requestTimes).toEqual([
    0,
    0,
    5_000,
    5_000,
    15_000,
    15_000,
    35_000,
    35_000,
  ])
  expect(requestTimes).toHaveLength(8)
})

test('realtime reconnect treats Retry-After as a minimum delay', async () => {
  const delays: number[] = []
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => new FakeSocket(),
    onState: () => undefined,
    scheduleReconnect: (_callback, delayMs) => {
      delays.push(delayMs)
      return 1
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-rate-limited',
    transport: {
      request: async () => {
        throw new ApiRequestError(429, 'RATE_LIMITED', 'Too many requests', 60)
      },
    } as AuthenticatedTransport,
  })

  session.start()
  await flushMicrotasks()

  expect(delays).toEqual([60_000])
})

test('only an authorised Tender view completes recovery and resets the reconnect backoff', async () => {
  const states: RealtimeState[] = []
  const delays: number[] = []
  const callbacks: Array<() => void> = []
  const sockets: FakeSocket[] = []
  let requestCount = 0
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    onState: (state) => states.push(state),
    scheduleReconnect: (callback, delayMs) => {
      callbacks.push(callback)
      delays.push(delayMs)
      return callbacks.length
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-reset-backoff',
    transport: {
      request: async () => {
        requestCount += 1
        if (requestCount === 1) throw new Error('ticket endpoint unavailable')
        return {
          expiresAt: '2026-07-25T00:00:00.000Z',
          ticket: 'ticket-ticket-ticket-ticket-ticket-123',
        }
      },
    } as AuthenticatedTransport,
  })

  session.start()
  await flushMicrotasks()
  callbacks[0]?.()
  await flushMicrotasks()
  sockets[0]?.emitOpen()

  expect(states.at(-1)?.connected).toBe(false)

  sockets[0]?.emitClose()
  callbacks[1]?.()
  await flushMicrotasks()
  sockets[1]?.emitOpen()
  sockets[1]?.emitMessage(tenderViewMessage('tender-reset-backoff', 1))

  expect(states.at(-1)?.connected).toBe(true)

  sockets[1]?.emitClose()

  expect(delays).toEqual([5_000, 10_000, 5_000])
})

test('realtime session never replaces a newer Tender view with an older frame', async () => {
  const states: RealtimeState[] = []
  const socket = new FakeSocket()
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => socket,
    onState: (state) => states.push(state),
    scheduleReconnect: () => 1,
    cancelReconnect: () => undefined,
    tenderId: 'tender-monotonic-view',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await flushMicrotasks()
  socket.emitOpen()
  socket.emitMessage(tenderViewMessage('tender-monotonic-view', 2))
  socket.emitMessage(tenderViewMessage('tender-monotonic-view', 1))

  expect(states.at(-1)?.tenderView?.version).toBe(2)
})

test('an equal authorised view completes recovery without replacing the cached Tender state', async () => {
  const states: RealtimeState[] = []
  const callbacks: Array<() => void> = []
  const delays: number[] = []
  const sockets: FakeSocket[] = []
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    onState: (state) => states.push(state),
    scheduleReconnect: (callback, delayMs) => {
      callbacks.push(callback)
      delays.push(delayMs)
      return callbacks.length
    },
    cancelReconnect: () => undefined,
    tenderId: 'tender-equal-recovery',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await flushMicrotasks()
  sockets[0]?.emitOpen()
  sockets[0]?.emitMessage(tenderViewMessage('tender-equal-recovery', 2))
  sockets[0]?.emitClose()
  callbacks[0]?.()
  await flushMicrotasks()
  sockets[1]?.emitOpen()

  expect(states.at(-1)?.connected).toBe(false)

  sockets[1]?.emitMessage(tenderViewMessage('tender-equal-recovery', 2))

  expect(states.at(-1)?.connected).toBe(true)
  expect(states.at(-1)?.tenderView?.version).toBe(2)

  sockets[1]?.emitClose()
  expect(delays).toEqual([5_000, 5_000])
})

test('an invalid server message blocks stale commands and closes the compromised connection', async () => {
  const states: RealtimeState[] = []
  const socket = new FakeSocket()
  const session = new TenderRealtimeSession({
    apiBaseUrl: 'https://api.test',
    createSocket: () => socket,
    onState: (state) => states.push(state),
    scheduleReconnect: () => 1,
    cancelReconnect: () => undefined,
    tenderId: 'tender-invalid-message',
    transport: resolvedTicketTransport(),
  })

  session.start()
  await Promise.resolve()
  await Promise.resolve()
  socket.emitOpen()
  socket.emitMessage(tenderViewMessage('tender-invalid-message', 1))
  socket.emitMessage('not-json')

  expect(states.at(-1)?.error).toBe('invalid-message')
  expect(states.at(-1)?.connected).toBe(false)
  expect(socket.readyState).toBe(socket.CLOSED)
})

class FakeSocket {
  readonly CLOSED = 3
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  close() {
    this.readyState = this.CLOSED
  }

  emitOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  emitClose(code = 1006) {
    this.readyState = this.CLOSED
    this.onclose?.({ code } as CloseEvent)
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>)
  }
}

function resolvedTicketTransport() {
  return {
    request: async () => ({
      expiresAt: '2026-07-25T00:00:00.000Z',
      ticket: 'ticket-ticket-ticket-ticket-ticket-123',
    }),
  } as AuthenticatedTransport
}

function tenderViewMessage(tenderId: string, version: number) {
  return JSON.stringify({
    type: 'tender-view',
    view: {
      knownSignals: [],
      phase: 'access-slot-selection',
      players: [{
        budget: 5,
        contractPowerRestriction: 0,
        playerId: 'player-a',
        rating: 0,
      }],
      privateMeasurements: [],
      privateRawTelemetrySignals: [],
      privateSamples: [],
      privateWorkingModel: { signals: {} },
      publicContracts: [],
      publicLaboratoryResults: [],
      publicTheses: [],
      round: 1,
      serverTime: '2026-08-24T12:00:00.000Z',
      tenderId,
      version,
    },
  })
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
