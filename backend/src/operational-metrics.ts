import type { MiddlewareHandler } from 'hono'

import type {
  TenderOperationalState,
  TenderOperationalStateReader,
} from './modules/tender'
import type { SecurityEvent, SecurityEventLogger } from './security/events'
import type { WorkerHealthSnapshot } from './worker-health'

export type OperationalMetricEvent =
  | { durationSeconds?: number; kind: 'api_request'; status: number }
  | { event: SecurityEvent; kind: 'security_event' }
  | { kind: 'realtime_connected'; reconnect: boolean }
  | { closeCode: number; kind: 'realtime_closed' }
  | {
      kind: 'mail_protection_transition'
      reason: 'delivery_budget_exhausted' | 'delivery_circuit_open'
    }

type OperationalMetricsOptions = {
  now?: () => number
  runtime?: 'api' | 'worker'
  tenderStateReader?: TenderOperationalStateReader
  workerHealth?: () => WorkerHealthSnapshot
}

const apiStatusClasses = ['1xx', '2xx', '3xx', '4xx', '5xx', 'other'] as const
const securityCategories = [
  'auth_throttled',
  'authentication_rejected',
  'authorization_rejected',
  'exceptional_condition',
  'request_rejected',
] as const
const realtimeCloseReasons = [
  'authentication',
  'capacity',
  'internal',
  'network',
  'normal',
  'other',
  'unavailable',
] as const
const mailProtectionReasons = [
  'delivery_budget_exhausted',
  'delivery_circuit_open',
] as const
const latencyBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

type ApiStatusClass = typeof apiStatusClasses[number]
type SecurityCategory = typeof securityCategories[number]
type RealtimeCloseReason = typeof realtimeCloseReasons[number]
type MailProtectionReason = typeof mailProtectionReasons[number]

export function createOperationalMetrics({
  now = Date.now,
  runtime = 'api',
  tenderStateReader,
  workerHealth,
}: OperationalMetricsOptions = {}) {
  const apiRequests = createCounterMap(apiStatusClasses)
  const apiLatencyBuckets = latencyBuckets.map(() => 0)
  let apiLatencyCount = 0
  let apiLatencySum = 0
  const securityEvents = createCounterMap(securityCategories)
  const realtimeConnections = { false: 0, true: 0 }
  const realtimeCloses = createCounterMap(realtimeCloseReasons)
  const mailProtectionTransitions = createCounterMap(mailProtectionReasons)

  function observe(event: OperationalMetricEvent) {
    if (event.kind === 'api_request') {
      increment(apiRequests, apiStatusClass(event.status))
      const durationSeconds = finiteNonnegative(event.durationSeconds ?? 0)
      apiLatencyCount += 1
      apiLatencySum += durationSeconds
      latencyBuckets.forEach((upperBound, index) => {
        if (durationSeconds <= upperBound) apiLatencyBuckets[index]! += 1
      })
      return
    }
    if (event.kind === 'security_event') {
      increment(securityEvents, securityCategory(event.event))
      return
    }
    if (event.kind === 'realtime_connected') {
      realtimeConnections[String(event.reconnect) as 'false' | 'true'] += 1
      return
    }
    if (event.kind === 'realtime_closed') {
      increment(realtimeCloses, realtimeCloseReason(event.closeCode))
      return
    }
    increment(mailProtectionTransitions, event.reason)
  }

  const apiRequestMiddleware: MiddlewareHandler = async (context, next) => {
    const startedAt = now()
    await next()
    observe({
      durationSeconds: finiteNonnegative((now() - startedAt) / 1_000),
      kind: 'api_request',
      status: context.res.status,
    })
  }

  function wrapSecurityEvents(logger: SecurityEventLogger): SecurityEventLogger {
    return {
      emit(event) {
        observe({ event, kind: 'security_event' })
        logger.emit(event)
      },
    }
  }

  async function fetch(request: Request) {
    if (new URL(request.url).pathname !== '/metrics') {
      return new Response('Not Found', { status: 404 })
    }

    try {
      const tenderState = tenderStateReader
        ? await tenderStateReader.read(new Date(now()))
        : undefined
      const body = renderMetrics({
        apiLatencyBuckets,
        apiLatencyCount,
        apiLatencySum,
        apiRequests,
        mailProtectionTransitions,
        realtimeCloses,
        realtimeConnections,
        runtime,
        securityEvents,
        tenderState,
        workerHealth: workerHealth?.(),
      })
      return new Response(body, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        },
      })
    } catch {
      return new Response('Operational metrics unavailable', {
        headers: { 'Cache-Control': 'no-store' },
        status: 503,
      })
    }
  }

  return {
    apiRequestMiddleware,
    fetch,
    observe,
    wrapSecurityEvents,
  }
}

export type OperationalMetrics = ReturnType<typeof createOperationalMetrics>

function renderMetrics(input: {
  apiLatencyBuckets: number[]
  apiLatencyCount: number
  apiLatencySum: number
  apiRequests: Record<ApiStatusClass, number>
  mailProtectionTransitions: Record<MailProtectionReason, number>
  realtimeCloses: Record<RealtimeCloseReason, number>
  realtimeConnections: Record<'false' | 'true', number>
  runtime: 'api' | 'worker'
  securityEvents: Record<SecurityCategory, number>
  tenderState?: TenderOperationalState
  workerHealth?: WorkerHealthSnapshot
}) {
  const lines: string[] = []
  if (input.runtime === 'api') {
    lines.push(
      '# HELP anomaly_detector_api_up API process availability reported by the private collector listener.',
      '# TYPE anomaly_detector_api_up gauge',
      'anomaly_detector_api_up 1',
      '# HELP anomaly_detector_api_requests_total API requests by bounded HTTP status class.',
      '# TYPE anomaly_detector_api_requests_total counter',
    )
    for (const statusClass of apiStatusClasses) {
      lines.push(`anomaly_detector_api_requests_total{status_class="${statusClass}"} ${input.apiRequests[statusClass]}`)
    }
    lines.push(
      '# HELP anomaly_detector_api_request_duration_seconds API request latency.',
      '# TYPE anomaly_detector_api_request_duration_seconds histogram',
    )
    latencyBuckets.forEach((upperBound, index) => {
      lines.push(`anomaly_detector_api_request_duration_seconds_bucket{le="${upperBound}"} ${input.apiLatencyBuckets[index]}`)
    })
    lines.push(
      `anomaly_detector_api_request_duration_seconds_bucket{le="+Inf"} ${input.apiLatencyCount}`,
      `anomaly_detector_api_request_duration_seconds_sum ${formatNumber(input.apiLatencySum)}`,
      `anomaly_detector_api_request_duration_seconds_count ${input.apiLatencyCount}`,
      '# HELP anomaly_detector_security_events_total Security events grouped by a bounded operational category.',
      '# TYPE anomaly_detector_security_events_total counter',
    )
    for (const category of securityCategories) {
      lines.push(`anomaly_detector_security_events_total{category="${category}"} ${input.securityEvents[category]}`)
    }
    lines.push(
      '# HELP anomaly_detector_realtime_connections_total Authorized realtime connections, split by client-declared reconnect.',
      '# TYPE anomaly_detector_realtime_connections_total counter',
      `anomaly_detector_realtime_connections_total{reconnect="false"} ${input.realtimeConnections.false}`,
      `anomaly_detector_realtime_connections_total{reconnect="true"} ${input.realtimeConnections.true}`,
      '# HELP anomaly_detector_realtime_closes_total Realtime socket closes grouped by bounded protocol reason.',
      '# TYPE anomaly_detector_realtime_closes_total counter',
    )
    for (const reason of realtimeCloseReasons) {
      lines.push(`anomaly_detector_realtime_closes_total{reason="${reason}"} ${input.realtimeCloses[reason]}`)
    }
  }

  if (input.tenderState) {
    lines.push(
      '# HELP anomaly_detector_tenders_overdue Active Tenders whose authoritative deadline has passed.',
      '# TYPE anomaly_detector_tenders_overdue gauge',
      `anomaly_detector_tenders_overdue ${input.tenderState.overdue}`,
      '# HELP anomaly_detector_matches Tenders grouped by operational lifecycle state.',
      '# TYPE anomaly_detector_matches gauge',
      `anomaly_detector_matches{state="active"} ${input.tenderState.active}`,
      `anomaly_detector_matches{state="completed"} ${input.tenderState.completed}`,
      `anomaly_detector_matches{state="early_finished"} ${input.tenderState.earlyFinished}`,
    )
  }

  if (input.workerHealth) {
    lines.push(
      '# HELP anomaly_detector_worker_loop_last_success_unixtime_seconds Last successful worker loop cycle.',
      '# TYPE anomaly_detector_worker_loop_last_success_unixtime_seconds gauge',
      '# HELP anomaly_detector_worker_loop_stale Whether a worker loop has missed its bounded heartbeat.',
      '# TYPE anomaly_detector_worker_loop_stale gauge',
      '# HELP anomaly_detector_worker_loop_consecutive_failures Consecutive failed cycles for a worker loop.',
      '# TYPE anomaly_detector_worker_loop_consecutive_failures gauge',
    )
    for (const loop of input.workerHealth.loops) {
      lines.push(
        `anomaly_detector_worker_loop_last_success_unixtime_seconds{loop="${loop.metricKey}"} ${loop.lastSucceededAt === null ? 0 : formatNumber(loop.lastSucceededAt / 1_000)}`,
        `anomaly_detector_worker_loop_stale{loop="${loop.metricKey}"} ${loop.stale ? 1 : 0}`,
        `anomaly_detector_worker_loop_consecutive_failures{loop="${loop.metricKey}"} ${loop.consecutiveFailures}`,
      )
    }
  }

  if (input.runtime === 'worker') {
    lines.push(
      '# HELP anomaly_detector_mail_protection_transitions_total Transactional-mail protection state transitions.',
      '# TYPE anomaly_detector_mail_protection_transitions_total counter',
    )
    for (const reason of mailProtectionReasons) {
      lines.push(`anomaly_detector_mail_protection_transitions_total{reason="${reason}"} ${input.mailProtectionTransitions[reason]}`)
    }
  }

  return `${lines.join('\n')}\n`
}

function createCounterMap<const K extends readonly string[]>(keys: K): Record<K[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K[number], number>
}

function increment<K extends string>(counters: Record<K, number>, key: K) {
  counters[key] += 1
}

function apiStatusClass(status: number): ApiStatusClass {
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return `${Math.floor(status / 100)}xx` as ApiStatusClass
  }
  return 'other'
}

function securityCategory(event: SecurityEvent): SecurityCategory {
  if (
    event.code === 'RATE_LIMITED'
    && event.outcome === 'limited'
    && (event.path === '/api/auth' || event.path.startsWith('/api/auth/'))
  ) return 'auth_throttled'
  if (securityCategories.includes(event.type)) return event.type
  return 'request_rejected'
}

function realtimeCloseReason(code: number): RealtimeCloseReason {
  if (code === 1000 || code === 1001) return 'normal'
  if (code === 1006) return 'network'
  if (code === 1011) return 'internal'
  if (code === 4401) return 'authentication'
  if (code === 4404) return 'unavailable'
  if (code === 4429) return 'capacity'
  return 'other'
}

function finiteNonnegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(9)))
}
