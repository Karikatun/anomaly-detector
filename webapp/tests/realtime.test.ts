import { expect, test } from 'bun:test'

import type { AuthenticatedTransport } from '../src/platform/api'
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

test('realtime session exposes a stable error code for an invalid server message', async () => {
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
  socket.emitMessage('not-json')

  expect(states.at(-1)?.error).toBe('invalid-message')
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

  emitClose() {
    this.readyState = this.CLOSED
    this.onclose?.({} as CloseEvent)
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
