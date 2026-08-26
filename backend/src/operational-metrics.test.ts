import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { SecurityEvent } from './security/events'
import { createOperationalMetrics } from './operational-metrics'

const tenderState = {
  active: 3,
  completed: 5,
  earlyFinished: 2,
  overdue: 1,
}

describe('operational metrics', () => {
  test('exports bounded API, security, realtime, mail, and Tender signals in Prometheus format', async () => {
    let now = 1_000
    const metrics = createOperationalMetrics({
      now: () => now,
      tenderStateReader: { read: async () => tenderState },
    })

    metrics.observe({ durationSeconds: 0.05, kind: 'api_request', status: 200 })
    now = 1_750
    metrics.observe({ durationSeconds: 0.75, kind: 'api_request', status: 503 })
    metrics.observe({
      event: {
        code: 'RATE_LIMITED',
        method: 'POST',
        occurredAt: '2026-08-25T10:00:00.000Z',
        outcome: 'limited',
        path: '/api/auth/login/private-user-id',
        requestId: 'private-request-id',
        type: 'request_rejected',
      },
      kind: 'security_event',
    })
    metrics.observe({
      event: {
        code: 'INTERNAL_ERROR',
        method: 'GET',
        occurredAt: '2026-08-25T10:00:00.000Z',
        outcome: 'failed',
        path: '/api/tenders/private-tender-id',
        reason: 'private-database-detail',
        requestId: 'private-request-id',
        type: 'exceptional_condition',
      },
      kind: 'security_event',
    })
    metrics.observe({ kind: 'realtime_connected', reconnect: false })
    metrics.observe({ kind: 'realtime_connected', reconnect: true })
    metrics.observe({ closeCode: 4401, kind: 'realtime_closed' })
    metrics.observe({ closeCode: 1006, kind: 'realtime_closed' })

    const response = await metrics.fetch(new Request('http://collector/metrics'))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toContain('anomaly_detector_api_up 1')
    expect(body).toContain('anomaly_detector_api_requests_total{status_class="2xx"} 1')
    expect(body).toContain('anomaly_detector_api_requests_total{status_class="5xx"} 1')
    expect(body).toContain('anomaly_detector_security_events_total{category="auth_throttled"} 1')
    expect(body).toContain('anomaly_detector_security_events_total{category="exceptional_condition"} 1')
    expect(body).toContain('anomaly_detector_realtime_connections_total{reconnect="false"} 1')
    expect(body).toContain('anomaly_detector_realtime_connections_total{reconnect="true"} 1')
    expect(body).toContain('anomaly_detector_realtime_closes_total{reason="authentication"} 1')
    expect(body).toContain('anomaly_detector_realtime_closes_total{reason="network"} 1')
    expect(body).toContain('anomaly_detector_tenders_overdue 1')
    expect(body).toContain('anomaly_detector_matches{state="active"} 3')
    expect(body).toContain('anomaly_detector_matches{state="completed"} 5')
    expect(body).toContain('anomaly_detector_matches{state="early_finished"} 2')
    expect(body).not.toContain('private-user-id')
    expect(body).not.toContain('private-tender-id')
    expect(body).not.toContain('private-request-id')
    expect(body).not.toContain('private-database-detail')

    const workerMetrics = createOperationalMetrics({ runtime: 'worker' })
    workerMetrics.observe({ kind: 'mail_protection_transition', reason: 'delivery_circuit_open' })
    const workerBody = await (await workerMetrics.fetch(new Request('http://collector/metrics'))).text()
    expect(workerBody).toContain('anomaly_detector_mail_protection_transitions_total{reason="delivery_circuit_open"} 1')
  })

  test('wraps security logging without changing request telemetry when either observer fails', () => {
    const emitted: SecurityEvent[] = []
    const metrics = createOperationalMetrics()
    const logger = metrics.wrapSecurityEvents({ emit: (event) => emitted.push(event) })
    const event: SecurityEvent = {
      code: 'UNAUTHORIZED',
      method: 'GET',
      occurredAt: '2026-08-25T10:00:00.000Z',
      outcome: 'denied',
      path: '/api/auth/me',
      requestId: 'request-id',
      type: 'authentication_rejected',
    }

    logger.emit(event)

    expect(emitted).toEqual([event])
  })

  test('serves only the exact private collector path and fails closed when state cannot be read', async () => {
    const unavailable = createOperationalMetrics({
      tenderStateReader: { read: async () => { throw new Error('database unavailable') } },
    })

    expect((await unavailable.fetch(new Request('http://collector/unknown'))).status).toBe(404)
    const response = await unavailable.fetch(new Request('http://collector/metrics'))
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Operational metrics unavailable')
  })

  test('counts an exceptional route as 5xx after the application error handler responds', async () => {
    const metrics = createOperationalMetrics()
    const app = new Hono()
    app.use('/api/*', metrics.apiRequestMiddleware)
    app.get('/api/failure', () => {
      throw new Error('private failure')
    })
    app.onError((_error, context) => context.json({ error: 'safe' }, 500))

    expect((await app.request('/api/failure')).status).toBe(500)
    const body = await (await metrics.fetch(new Request('http://collector/metrics'))).text()

    expect(body).toContain('anomaly_detector_api_requests_total{status_class="5xx"} 1')
  })
})
