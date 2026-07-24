import type { RealtimeServerMessage, TenderView } from '@anomaly-detector/contracts'
import {
  realtimeServerMessageSchema,
  realtimeTicketResponseSchema,
} from '@anomaly-detector/contracts'
import { useCallback, useEffect, useState } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { getApiBaseUrl } from '@/platform/api/api-base-url'

export type RealtimeState = {
  connected: boolean
  error: string | null
  tenderView: TenderView | null
}

type RealtimeSocket = {
  close(): void
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onopen: ((event: Event) => void) | null
}

type RealtimeSessionOptions = {
  apiBaseUrl: string
  cancelReconnect: (timer: ReturnType<typeof setTimeout>) => void
  createSocket: (url: string) => RealtimeSocket
  onState: (state: RealtimeState) => void
  scheduleReconnect: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  tenderId: string
  transport: AuthenticatedTransport
}

const disconnectedState = (): RealtimeState => ({
  connected: false,
  error: null,
  tenderView: null,
})

export class TenderRealtimeSession {
  private readonly options: RealtimeSessionOptions
  private state = disconnectedState()
  private socket: RealtimeSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private connecting = false
  private started = false
  private stopped = false

  constructor(options: RealtimeSessionOptions) {
    this.options = options
  }

  start() {
    if (this.started) return
    this.started = true
    this.stopped = false
    this.state = disconnectedState()
    this.options.onState(this.state)
    void this.connect()
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.generation += 1
    this.clearReconnect()

    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
  }

  private async connect() {
    if (this.stopped || this.connecting || this.socket) return

    this.connecting = true
    const generation = ++this.generation

    try {
      const ticketResponse = await this.options.transport.request(
        '/api/realtime/tickets',
        realtimeTicketResponseSchema,
        { method: 'POST' },
      )
      if (this.stopped || generation !== this.generation) return

      const wsUrl = this.options.apiBaseUrl.replace(/^http/, 'ws')
      const socket = this.options.createSocket(
        `${wsUrl}/api/realtime/ws?ticket=${encodeURIComponent(ticketResponse.ticket)}&tenderId=${encodeURIComponent(this.options.tenderId)}`,
      )
      this.socket = socket

      socket.onopen = () => {
        if (!this.owns(socket)) return
        this.updateState({ connected: true, error: null })
      }

      socket.onmessage = (event) => {
        if (!this.owns(socket)) return
        this.handleMessage(event)
      }

      socket.onerror = () => {
        if (!this.owns(socket)) return
        this.updateState({
          connected: false,
          error: 'Realtime connection failed',
        })
      }

      socket.onclose = () => {
        if (!this.owns(socket)) return
        this.socket = null
        this.updateState({ connected: false })
        this.scheduleReconnect()
      }
    } catch (error) {
      if (this.stopped || generation !== this.generation) return
      this.updateState({
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to connect to realtime',
      })
      this.scheduleReconnect()
    } finally {
      if (generation === this.generation) {
        this.connecting = false
      }
    }
  }

  private handleMessage(event: MessageEvent<string>) {
    try {
      const message = realtimeServerMessageSchema.parse(JSON.parse(event.data)) as RealtimeServerMessage
      if (message.type === 'tender-view') {
        this.updateState({ tenderView: message.view })
      } else {
        this.updateState({ error: message.error.message })
      }
    } catch {
      this.updateState({ error: 'Invalid server message' })
    }
  }

  private owns(socket: RealtimeSocket) {
    return !this.stopped && this.socket === socket
  }

  private updateState(patch: Partial<RealtimeState>) {
    if (this.stopped) return
    this.state = { ...this.state, ...patch }
    this.options.onState(this.state)
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = this.options.scheduleReconnect(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 5_000)
  }

  private clearReconnect() {
    if (!this.reconnectTimer) return
    this.options.cancelReconnect(this.reconnectTimer)
    this.reconnectTimer = null
  }
}

export function useRealtimeTender(transport: AuthenticatedTransport, tenderId: string) {
  const [state, setState] = useState<RealtimeState>(disconnectedState)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const session = new TenderRealtimeSession({
      apiBaseUrl: getApiBaseUrl(),
      cancelReconnect: clearTimeout,
      createSocket: (url) => new WebSocket(url),
      onState: setState,
      scheduleReconnect: setTimeout,
      tenderId,
      transport,
    })
    session.start()

    return () => session.stop()
  }, [attempt, tenderId, transport])

  const retry = useCallback(() => {
    setAttempt((currentAttempt) => currentAttempt + 1)
  }, [])

  return { ...state, retry }
}
