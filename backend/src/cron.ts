import { createBackendRuntime, type BackendRuntime } from './runtime'
import { isRetryableDatabaseTransactionConflict } from './db'
import { cleanupAnalyticsData } from './modules/analytics'
import { cleanupExpiredAuthRecovery } from './modules/auth'
import { cleanupFeedbackReports } from './modules/feedback'
import {
  cleanupExpiredMailDomainAssessments,
  cleanupExpiredPendingMailOutbox,
  cleanupTerminalMailOutbox,
} from './modules/mail'

type CronTask = (runtime: BackendRuntime, now: Date) => Promise<void>

const waitingRoomTtlMs = 24 * 60 * 60 * 1000
const retentionTransactionMaxAttempts = 3

async function cleanupRecoveryAndPendingMail(
  prisma: BackendRuntime['prisma'],
  now: Date,
) {
  for (let attempt = 0; attempt < retentionTransactionMaxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const pendingMail = await cleanupExpiredPendingMailOutbox(tx, now)
        const recovery = await cleanupExpiredAuthRecovery(tx, now)
        return { pendingMail: pendingMail.count, recovery: recovery.count }
      })
    } catch (error) {
      if (!isRetryableDatabaseTransactionConflict(error) || attempt >= retentionTransactionMaxAttempts - 1) {
        throw error
      }
      await waitForRetentionTransactionRetry(attempt)
    }
  }

  throw new Error('Unreachable retention transaction retry state')
}

function waitForRetentionTransactionRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)))
}

const cleanupMaintenance: CronTask = async ({ env, prisma }, now) => {
  const dayMs = 24 * 60 * 60 * 1000
  const retentionCutoff = new Date(
    now.getTime() - env.SESSION_RETENTION_DAYS * dayMs,
  )
  const absoluteRetentionCutoff = new Date(
    now.getTime() - (env.SESSION_ABSOLUTE_TTL_DAYS + env.SESSION_RETENTION_DAYS) * dayMs,
  )
  const waitingRoomCutoff = new Date(now.getTime() - waitingRoomTtlMs)
  const mailOutboxCutoff = new Date(
    now.getTime() - env.MAIL_OUTBOX_RETENTION_DAYS * dayMs,
  )
  const [sessions, abuseBuckets, oauthTransactions, realtimeTickets, waitingRooms, mailDomainAssessments, recoveryAndPendingMail, mailOutbox, feedback, analytics] = await Promise.all([
    prisma.authSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: retentionCutoff } },
          { revokedAt: { lt: retentionCutoff } },
          { createdAt: { lt: absoluteRetentionCutoff } },
        ],
      },
    }),
    prisma.authAbuseBucket.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    prisma.oAuthTransaction.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    prisma.realtimeTicket.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    prisma.tenderRoom.deleteMany({
      where: {
        createdAt: { lt: waitingRoomCutoff },
        status: 'waiting',
      },
    }),
    cleanupExpiredMailDomainAssessments(prisma, now),
    cleanupRecoveryAndPendingMail(prisma, now),
    cleanupTerminalMailOutbox(prisma, mailOutboxCutoff),
    cleanupFeedbackReports(prisma, now),
    cleanupAnalyticsData(prisma, now),
  ])
  console.log(
    `Cron maintenance:cleanup removed ${sessions.count} stale sessions, ${abuseBuckets.count} expired abuse buckets, ${oauthTransactions.count} OAuth transactions, ${realtimeTickets.count} realtime tickets, ${waitingRooms.count} expired waiting rooms, and ${mailDomainAssessments.count} expired mail-domain assessments; cleaned ${recoveryAndPendingMail.recovery} expired recovery artifacts and ${recoveryAndPendingMail.pendingMail} expired pending mail records; removed ${mailOutbox.count} terminal mail outbox records, ${feedback.count} expired feedback reports, ${analytics.journeys} expired analytics journeys, and ${analytics.aggregates} expired analytics aggregates.`,
  )
}

const cleanupAnalytics: CronTask = async ({ prisma }, now) => {
  const result = await cleanupAnalyticsData(prisma, now)
  console.log(
    `Cron analytics:cleanup removed ${result.journeys} expired journeys and ${result.aggregates} expired aggregates.`,
  )
}

const cronTasks = {
  noop: async () => {
    console.log('Cron noop task completed.')
  },
  'db:ping': async ({ prisma }) => {
    await prisma.$queryRaw`SELECT 1`
    console.log('Cron db:ping task completed.')
  },
  'maintenance:cleanup': cleanupMaintenance,
  'auth:sessions:cleanup': cleanupMaintenance,
  'analytics:cleanup': cleanupAnalytics,
} satisfies Record<string, CronTask>

export type CronTaskName = keyof typeof cronTasks

export async function runCronTask(
  taskName: string,
  runtime: BackendRuntime,
  now = new Date(),
) {
  const task = cronTasks[taskName as CronTaskName]

  if (!task) {
    throw new Error(`Unknown cron task "${taskName}". Available tasks: ${Object.keys(cronTasks).join(', ')}`)
  }

  await task(runtime, now)
}

export async function main(argv: string[] = Bun.argv.slice(2)) {
  const [taskName] = argv

  if (!taskName) {
    console.error(`Cron task name is required. Available tasks: ${Object.keys(cronTasks).join(', ')}`)
    process.exit(1)
  }

  const runtime = createBackendRuntime()

  try {
    await runCronTask(taskName, runtime)
  } finally {
    await runtime.close()
  }
}

if (import.meta.main) {
  await main()
}
