import { createBackendRuntime } from './runtime'
import { createRoomStartModule } from './modules/room'
import { createMailModule, createRegRuSmtpDelivery } from './modules/mail'
import { createPrismaTenderStore } from './modules/tender'
import { createTenderModule } from './modules/tender'
import { createWorkerHealth, type WorkerLoopHealth } from './worker-health'

export async function runWorker() {
  const runtime = createBackendRuntime()
  const store = createPrismaTenderStore(runtime.prisma)
  const tender = createTenderModule({ store })
  const roomStart = createRoomStartModule(runtime.prisma)
  const mail = runtime.env.MAIL_SMTP_ENABLED
    ? createMailModule({
        db: runtime.prisma,
        delivery: createRegRuSmtpDelivery({
          from: runtime.env.MAIL_SMTP_FROM!,
          host: runtime.env.MAIL_SMTP_HOST!,
          password: runtime.env.MAIL_SMTP_PASSWORD!,
          port: runtime.env.MAIL_SMTP_PORT!,
          replyTo: runtime.env.MAIL_SMTP_REPLY_TO!,
          timeoutMs: runtime.env.MAIL_SMTP_TIMEOUT_MS,
          tlsMode: runtime.env.MAIL_SMTP_TLS_MODE!,
          username: runtime.env.MAIL_SMTP_USERNAME!,
        }),
        deliveryOptions: {
          circuitFailureThreshold: runtime.env.MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD,
          circuitOpenMs: runtime.env.MAIL_SMTP_CIRCUIT_OPEN_SECONDS * 1_000,
          deliveryBudgetPerMinute: runtime.env.MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE,
          leaseMs: runtime.env.MAIL_SMTP_LEASE_SECONDS * 1_000,
          maxAttempts: runtime.env.MAIL_SMTP_MAX_ATTEMPTS,
          retryBaseMs: runtime.env.MAIL_SMTP_RETRY_BASE_SECONDS * 1_000,
        },
      })
    : null
  const health = createWorkerHealth()
  const healthPort = runtime.env.WORKER_HEALTH_PORT ?? runtime.env.PORT + 1
  const healthServer = Bun.serve({
    fetch: health.fetch,
    hostname: '0.0.0.0',
    port: healthPort,
  })

  console.log(
    `Worker: starting advance loops for due Tenders and Rooms${mail ? ' plus transactional mail delivery' : ''}; health listening on ${healthServer.hostname}:${healthServer.port}`,
  )
  const stopTenderAdvanceLoop = startPollingLoop({
    health: health.registerLoop({
      intervalMs: 2_000,
      label: 'Tender advancement',
    }),
    intervalMs: 2_000,
    label: 'Tender advancement',
    task: async () => {
      const result = await tender.advanceDueTenders({ limit: 50, now: new Date() })
      await roomStart.releaseCompletedCurrentMatches()
      return result
    },
  })
  const stopRoomStartLoop = startPollingLoop({
    health: health.registerLoop({
      intervalMs: 250,
      label: 'Room start',
    }),
    intervalMs: 250,
    label: 'Room start',
    task: () => roomStart.advanceDueRoomStarts({ now: new Date() }),
  })
  const mailWorkerId = `mail-${crypto.randomUUID()}`
  const stopMailDeliveryLoop = mail?.outboxDrainer
    ? startPollingLoop({
        health: health.registerLoop({
          intervalMs: runtime.env.MAIL_SMTP_WORKER_INTERVAL_MS,
          label: 'Transactional mail delivery',
        }),
        intervalMs: runtime.env.MAIL_SMTP_WORKER_INTERVAL_MS,
        label: 'Transactional mail delivery',
        task: () => mail.outboxDrainer!.drain({
          limit: 20,
          now: new Date(),
          workerId: mailWorkerId,
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
      stopRoomStartLoop(),
      stopMailDeliveryLoop?.(),
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
