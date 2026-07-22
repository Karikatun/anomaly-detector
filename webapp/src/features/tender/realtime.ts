import type { RealtimeServerMessage, TenderView } from '@anomaly-detector/contracts'
import { realtimeServerMessageSchema } from '@anomaly-detector/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'

import type { AuthenticatedTransport } from '@/platform/api'
import { getApiBaseUrl } from '@/platform/api/api-base-url'

const RealtimeTicketResponseSchema = z.object({
  expiresAt: z.string().datetime(),
  ticket: z.string().min(32),
}).strict()

type RealtimeState = {
  connected: boolean
  error: string | null
  tenderView: TenderView | null
}

export function useRealtimeTender(transport: AuthenticatedTransport, tenderId: string) {
  const [state, setState] = useState<RealtimeState>({
    connected: false,
    error: null,
    tenderView: null,
  })
  const wsRef = useRef<WebSocket | null>(null)
  const tenderIdRef = useRef(tenderId)
  tenderIdRef.current = tenderId

  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    try {
      const ticketResponse = await transport.request(
        '/api/realtime/tickets',
        RealtimeTicketResponseSchema,
        { method: 'POST' },
      )

      const apiBase = getApiBaseUrl()
      const wsUrl = apiBase.replace(/^http/, 'ws')
      const ws = new WebSocket(
        `${wsUrl}/api/realtime/ws?ticket=${encodeURIComponent(ticketResponse.ticket)}&tenderId=${encodeURIComponent(tenderIdRef.current)}`,
      )

      wsRef.current = ws

      ws.onopen = () => {
        setState((prev) => ({ ...prev, connected: true, error: null }))
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data)
          const message = realtimeServerMessageSchema.parse(parsed) as RealtimeServerMessage
          if (message.type === 'tender-view') {
            setState((prev) => ({ ...prev, tenderView: message.view }))
          } else if (message.type === 'error') {
            setState((prev) => ({ ...prev, error: message.error.message }))
          }
        } catch {
          setState((prev) => ({ ...prev, error: 'Invalid server message' }))
        }
      }

      ws.onclose = () => {
        setState((prev) => ({ ...prev, connected: false }))
        wsRef.current = null
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        connected: false,
        error: err instanceof Error ? err.message : 'Failed to connect to realtime',
      }))
    }
  }, [transport])

  useEffect(() => {
    void connect()

    const reconnectInterval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        void connect()
      }
    }, 5000)

    return () => {
      clearInterval(reconnectInterval)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return state
}
