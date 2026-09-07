import { createBackendRuntime } from './runtime'
import { createRoomStartModule } from './modules/room'
import {
  createMailModule,
  createRegRuSmtpDelivery,
  type ClaimedMailDeliveryProtectionAlert,
} from './modules/mail'
import { createPrismaTenderStore } from './modules/tender'
import { createTenderModule } from './modules/tender'
import { createPersistentTenderBotRunner } from './modules/tender'
import { createOperationalMetrics, type OperationalMetrics } from './operational-metrics'
import {
  createWorkerHealth,
  type WorkerLoopHealth,
} from './worker-health'

export async function runWorker() {
  const runtime = createBackendRuntime()
  const store = createPrismaTenderStore(runtime.prisma, runtime.env.JWT_SECRET)
  const tender = createTenderModule({ store })
  const bots = createPersistentTenderBotRunner(runtime.prisma, runtime.env.JWT_SECRET)
  const roomStart = createRoomStartModule(runtime.prisma, runtime.env.JWT_SECRET)
  const mailDeliveryOptions = {
    circuitFailureThreshold: runtime.env.MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD,
    circuitOpenMs: runtime.env.MAIL_SMTP_CIRCUIT_OPEN_SECONDS * 1_000,
    deliveryBudgetPerMinute: runtime.env.MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE,
    leaseMs: runtime.env.MAIL_SMTP_LEASE_SECONDS * 1_000,
    maxAttempts: runtime.env.MAIL_SMTP_MAX_ATTEMPTS,
    retryBaseMs: runtime.env.MAIL_SMTP_RETRY_BASE_SECONDS * 1_000,
  }
  const mail = createMailModule({
    accountLifecycleSecret: runtime.env.JWT_SECRET,
    confirmationCodeSecret: runtime.env.MAIL_SMTP_ENABLED ? runtime.env.JWT_SECRET : undefined,
    db: runtime.prisma,
    delivery: runtime.env.MAIL_SMTP_ENABLED
      ? createRegRuSmtpDelivery({
          from: runtime.env.MAIL_SMTP_FROM!,
          host: runtime.env.MAIL_SMTP_HOST!,
          password: runtime.env.MAIL_SMTP_PASSWORD!,
          port: runtime.env.MAIL_SMTP_PORT!,
          replyTo: runtime.env.MAIL_SMTP_REPLY_TO!,
          timeoutMs: runtime.env.MAIL_SMTP_TIMEOUT_MS,
          tlsMode: runtime.env.MAIL_SMTP_TLS_MODE!,
          username: runtime.env.MAIL_SMTP_USERNAME!,
        })
      : undefined,
    deliveryOptions: mailDeliveryOptions,
    deliveryStatus: {
      configured: runtime.env.MAIL_SMTP_ENABLED,
      deliveryBudgetPerMinute: runtime.env.MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE,
    },
  })
  const health = createWorkerHealth()
  const operationalMetrics = createOperationalMetrics({
    mailProtectionAlertStateReader: mail.protectionAlertStateReader,
    runtime: 'worker',
    workerHealth: health.snapshot,
  })
  const healthPort = runtime.env.WORKER_HEALTH_PORT ?? runtime.env.PORT + 1
  const healthServer = Bun.serve({
    fetch: createWorkerHttpFetch({ health, operationalMetrics }),
    hostname: runtime.env.WORKER_HEALTH_HOST ?? '127.0.0.1',
    port: healthPort,
  })

  console.log(
    `Worker: starting advance loops for due Tenders and Rooms${mail.outboxDrainer ? ' plus transactional mail delivery' : ''} plus mail protection alerts; health listening on ${healthServer.hostname}:${healthServer.port}`,
  )
  const stopTenderAdvanceLoop = startPollingLoop({
    health: health.registerLoop({
      intervalMs: 2_000,
      label: 'Tender advancement',
      metricKey: 'tender_advancement',
    }),
    intervalMs: 2_000,
    label: 'Tender advancement',
    task: async () => {
      const result = await tender.advanceDueTenders({ limit: 50, now: new Date() })
      await roomStart.releaseCompletedCurrentMatches()
      return result
    },
  })
  const stopBotLoop = startPollingLoop({
    health: health.registerLoop({ intervalMs: 500, label: 'Bot decisions', metricKey: 'bot_decisions' }),
    intervalMs: 500,
    label: 'Bot decisions',
    task: async () => {
      const startedAt = Date.now()
      const result = await bots.advance({ limit: 50 })
      operationalMetrics.observe({
        acceptedCommands: result.acceptedCommands,
        durationSeconds: (Date.now() - startedAt) / 1_000,
        failedTenders: result.failedTenders,
        kind: 'bot_batch',
      })
      if (result.failedTenders > 0) throw new Error('Some bot decisions failed')
      return result
    },
  })
  const stopRoomStartLoop = startPollingLoop({
    health: health.registerLoop({
      intervalMs: 250,
      label: 'Room start',
      metricKey: 'room_start',
    }),
    intervalMs: 250,
    label: 'Room start',
    task: () => roomStart.advanceDueRoomStarts({ now: new Date() }),
  })
  const mailWorkerId = `mail-${crypto.randomUUID()}`
  const mailAlertWorkerId = `mail-alert-${crypto.randomUUID()}`
  const stopMailDeliveryLoop = mail.outboxDrainer
    ? startPollingLoop({
        health: health.registerLoop({
          intervalMs: runtime.env.MAIL_SMTP_WORKER_INTERVAL_MS,
          label: 'Transactional mail delivery',
          metricKey: 'transactional_mail_delivery',
        }),
        intervalMs: runtime.env.MAIL_SMTP_WORKER_INTERVAL_MS,
        label: 'Transactional mail delivery',
        task: async () => {
          const result = await mail.outboxDrainer!.drain({
            limit: 20,
            now: new Date(),
            workerId: mailWorkerId,
          })
          recordMailProtectionTransitions({
            observe: operationalMetrics.observe,
            protectionAlerts: result.protectionAlerts,
          })
          return result
        },
      })
    : null
  const stopMailProtectionAlertLoop = mail.protectionAlertDispatcher
    ? startPollingLoop({
        health: health.registerLoop({
          intervalMs: runtime.env.MAIL_SMTP_WORKER_INTERVAL_MS,
          label: 'Mail protection alert delivery',
          metricKey: 'mail_protection_alert_delivery',
        }),
        intervalMs: runtime.env.MAIL_SMTP_WORKER_INTERVAL_MS,
        label: 'Mail protection alert delivery',
        task: () => dispatchMailProtectionAlerts({
          dispatcher: mail.protectionAlertDispatcher!,
          now: new Date(),
          workerId: mailAlertWorkerId,
        }),
      })
    : null

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Worker: received ${signal}; shutting down`)
    await healthServer.stop(true)
    await Promise.all([
      stopTenderAdvanceLoop(),
      stopBotLoop(),
      stopRoomStartLoop(),
      stopMailDeliveryLoop?.(),
      stopMailProtectionAlertLoop?.(),
    ])
    await runtime.close()
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

export async function dispatchMailProtectionAlerts(input: {
  dispatcher: {
    dispatch(options: {
      deliver(alert: ClaimedMailDeliveryProtectionAlert): Promise<void> | void
      limit: number
      now: Date
      workerId: string
    }): Promise<{ claimed: number; delivered: number; failed: number; staleClaims: number }>
  }
  now: Date
  workerId: string
}) {
  const result = await input.dispatcher.dispatch({
    deliver: (alert) => emitMailDeliveryProtectionAlert(alert),
    limit: 20,
    now: input.now,
    workerId: input.workerId,
  })
  if (result.failed > 0 || result.staleClaims > 0) {
    throw new Error('Mail protection alert delivery failed')
  }
  return result
}

export function createWorkerHttpFetch(input: {
  health: ReturnType<typeof createWorkerHealth>
  operationalMetrics: OperationalMetrics
}) {
  return (request: Request) => new URL(request.url).pathname === '/metrics'
    ? input.operationalMetrics.fetch(request)
    : input.health.fetch(request)
}

export function recordMailProtectionTransitions(input: {
  observe: OperationalMetrics['observe']
  protectionAlerts: Array<{
    reason: 'delivery_budget_exhausted' | 'delivery_circuit_open'
  }>
}) {
  for (const alert of input.protectionAlerts) {
    input.observe({
      kind: 'mail_protection_transition',
      reason: alert.reason,
    })
  }
}

export function emitMailDeliveryProtectionAlert(
  alert: ClaimedMailDeliveryProtectionAlert,
  logger: { warn(message: string): void } = console,
) {
  if (
    alert.reason !== 'delivery_budget_exhausted'
    && alert.reason !== 'delivery_circuit_open'
  ) throw new Error('Invalid mail delivery protection alert reason')
  if (!(alert.occurredAt instanceof Date) || Number.isNaN(alert.occurredAt.getTime())) {
    throw new Error('Invalid mail delivery protection alert timestamp')
  }
  if (!(alert.transitionAt instanceof Date) || Number.isNaN(alert.transitionAt.getTime())) {
    throw new Error('Invalid mail delivery protection alert transition')
  }
  logger.warn(JSON.stringify({
    channel: 'security',
    occurredAt: alert.occurredAt.toISOString(),
    reason: alert.reason,
    transitionAt: alert.transitionAt.toISOString(),
    type: 'mail_delivery_protection_activated',
  }))
}

export function startPollingLoop(input: {
  health: WorkerLoopHealth
  intervalMs: number
  label: string
  task: () => Promise<unknown>
}) {
  let currentRun: Promise<void> | undefined
  const tick = () => {
    if (currentRun) return
    input.health.started()
    currentRun = Promise.resolve()
      .then(input.task)
      .then(() => input.health.succeeded())
      .catch((error) => {
        input.health.failed(error)
        console.error(`Worker: ${input.label} failed`, error)
      })
      .finally(() => {
        currentRun = undefined
      })
  }
  tick()
  const timer = setInterval(tick, input.intervalMs)
  return async () => {
    clearInterval(timer)
    await currentRun
  }
}

export async function main() {
  await runWorker()
}

if (import.meta.main) {
  await main()
}
