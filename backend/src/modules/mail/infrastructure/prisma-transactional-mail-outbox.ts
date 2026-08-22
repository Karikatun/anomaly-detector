import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import type {
  MailOutboxClaimResult,
  MailOutboxRepository,
  TransactionalMailWriter,
  TransactionalMailWriteResult,
} from '../application/transactional-mail-ports'

type TransactionalMailWriterDb = Pick<Prisma.TransactionClient, 'mailOutboxMessage'>
type TransactionalMailCancellationDb = Pick<
  Prisma.TransactionClient,
  'mailDeliveryAttempt' | 'mailOutboxMessage'
>

export async function cancelQueuedTransactionalMail(
  db: TransactionalMailCancellationDb,
  input: { messageId: string; now: Date },
) {
  const cancelled = await db.mailOutboxMessage.updateMany({
    where: {
      messageId: input.messageId,
      state: 'queued',
    },
    data: {
      completedAt: input.now,
      lastFailureCode: 'owner_operation_cancelled',
      leaseExpiresAt: null,
      leaseOwner: null,
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    },
  })
  if (cancelled.count === 0) return false
  const message = await db.mailOutboxMessage.findUniqueOrThrow({
    where: { messageId: input.messageId },
    select: { id: true },
  })
  await db.mailDeliveryAttempt.create({
    data: {
      attemptedAt: input.now,
      failureCode: 'owner_operation_cancelled',
      outcome: 'terminal_failure',
      outboxId: message.id,
    },
  })
  return true
}

export function createPrismaTransactionalMailWriter(
  db: TransactionalMailWriterDb,
): TransactionalMailWriter {
  return {
    async enqueue(input): Promise<TransactionalMailWriteResult> {
      const inserted = await db.mailOutboxMessage.createMany({
        data: {
          fingerprint: input.fingerprint,
          messageId: input.messageId,
          providerMessageId: `<${input.messageId}@anomaly-detector.ru>`,
          recipient: input.recipient,
          recipientDomain: input.recipientDomain,
          templateKind: input.template.kind,
          templatePayload: input.template as Prisma.InputJsonValue,
        },
        skipDuplicates: true,
      })
      if (inserted.count === 1) return { kind: 'inserted' }

      const existing = await db.mailOutboxMessage.findUnique({
        where: { messageId: input.messageId },
        select: { fingerprint: true },
      })
      if (!existing) {
        throw new Error('Transactional mail identity conflict')
      }
      return { fingerprint: existing.fingerprint.trim(), kind: 'exists' }
    },
  }
}

const DELIVERY_CONTROL_ID = 'reg_ru'
const DELIVERY_WINDOW_MS = 60_000

export type MailOutboxRepositoryOptions = {
  circuitFailureThreshold: number
  circuitOpenMs: number
  deliveryBudgetPerMinute: number
  leaseMs: number
  maxAttempts: number
  retryBaseMs: number
}

export function createPrismaMailOutboxRepository(
  db: DbClient,
  options: MailOutboxRepositoryOptions,
): MailOutboxRepository {
  return {
    claim: (input) => claimNext(db, options, input),
    recordAccepted: (input) => recordAccepted(db, input),
    recordFailure: (input) => recordFailure(db, options, input),
    releaseBlocked: (input) => releaseBlocked(db, options, input),
  }
}

async function claimNext(
  db: DbClient,
  options: MailOutboxRepositoryOptions,
  input: { now: Date; workerId: string },
): Promise<MailOutboxClaimResult> {
  return db.$transaction<MailOutboxClaimResult>(async (tx) => {
    await ensureAndLockControl(tx, input.now)
    let control = await tx.mailDeliveryControl.findUniqueOrThrow({
      where: { id: DELIVERY_CONTROL_ID },
    })
    if (input.now.getTime() - control.windowStartedAt.getTime() >= DELIVERY_WINDOW_MS) {
      control = await tx.mailDeliveryControl.update({
        where: { id: DELIVERY_CONTROL_ID },
        data: { deliveriesInWindow: 0, windowStartedAt: input.now },
      })
    }
    if (control.circuitOpenUntil && control.circuitOpenUntil > input.now) {
      return { kind: 'circuit_open' }
    }
    if (control.deliveriesInWindow >= options.deliveryBudgetPerMinute) {
      return { kind: 'budget_exhausted' }
    }

    const selected = await tx.$queryRaw<Array<{
      attempt_count: number
      id: string
      state: string
    }>>`
      SELECT id, state, attempt_count
      FROM mail_outbox_messages
      WHERE (
        (state = 'queued' AND available_at <= ${input.now})
        OR (state = 'leased' AND lease_expires_at <= ${input.now})
      )
      ORDER BY available_at ASC, created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `
    const candidate = selected[0]
    if (!candidate) return { kind: 'empty' }

    if (candidate.state === 'leased') {
      if (candidate.attempt_count >= options.maxAttempts) {
        await tx.mailOutboxMessage.update({
          where: { id: candidate.id },
          data: {
            completedAt: input.now,
            lastFailureCode: 'worker_lease_exhausted',
            leaseExpiresAt: null,
            leaseOwner: null,
            recipient: '[redacted]',
            state: 'terminal_failure',
            templatePayload: {},
          },
        })
        await tx.mailDeliveryAttempt.create({
          data: {
            attemptedAt: input.now,
            failureCode: 'worker_lease_exhausted',
            outcome: 'terminal_failure',
            outboxId: candidate.id,
          },
        })
        return { kind: 'empty' }
      }
      await tx.mailDeliveryAttempt.create({
        data: {
          attemptedAt: input.now,
          failureCode: 'worker_lease_expired',
          outcome: 'temporary_failure',
          outboxId: candidate.id,
        },
      })
    }

    const leaseExpiresAt = new Date(input.now.getTime() + options.leaseMs)
    const message = await tx.mailOutboxMessage.update({
      where: { id: candidate.id },
      data: {
        attemptCount: { increment: 1 },
        leaseExpiresAt,
        leaseOwner: input.workerId,
        state: 'leased',
      },
    })
    await tx.mailDeliveryControl.update({
      where: { id: DELIVERY_CONTROL_ID },
      data: {
        circuitOpenUntil: control.circuitOpenUntil ? leaseExpiresAt : null,
        deliveriesInWindow: { increment: 1 },
      },
    })
    return {
      kind: 'claimed',
      message: {
        attemptCount: message.attemptCount,
        createdAt: message.createdAt,
        id: message.id,
        messageId: message.messageId,
        providerMessageId: message.providerMessageId,
        recipient: message.recipient,
        recipientDomain: message.recipientDomain,
        template: message.templatePayload,
      },
    }
  })
}

async function recordAccepted(
  db: DbClient,
  input: { id: string; now: Date; workerId: string },
) {
  return db.$transaction(async (tx) => {
    await ensureAndLockControl(tx, input.now)
    await lockOutboxRow(tx, input.id)
    const message = await tx.mailOutboxMessage.findFirst({
      where: { id: input.id, leaseOwner: input.workerId, state: 'leased' },
      select: { id: true },
    })
    if (!message) return false
    await tx.mailOutboxMessage.update({
      where: { id: input.id },
      data: {
        completedAt: input.now,
        lastFailureCode: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        recipient: '[redacted]',
        state: 'smtp_accepted',
        templatePayload: {},
      },
    })
    await tx.mailDeliveryAttempt.create({
      data: {
        attemptedAt: input.now,
        outcome: 'smtp_accepted',
        outboxId: input.id,
      },
    })
    await tx.mailDeliveryControl.update({
      where: { id: DELIVERY_CONTROL_ID },
      data: {
        circuitOpenUntil: null,
        consecutiveFailures: 0,
        lastSuccessAt: input.now,
      },
    })
    return true
  })
}

async function recordFailure(
  db: DbClient,
  options: MailOutboxRepositoryOptions,
  input: {
    affectsCircuit: boolean
    code: string
    id: string
    now: Date
    temporary: boolean
    workerId: string
  },
) {
  return db.$transaction<'queued' | 'stale_claim' | 'terminal_failure'>(async (tx) => {
    await ensureAndLockControl(tx, input.now)
    await lockOutboxRow(tx, input.id)
    const message = await tx.mailOutboxMessage.findFirst({
      where: { id: input.id, leaseOwner: input.workerId, state: 'leased' },
      select: { attemptCount: true, id: true },
    })
    if (!message) return 'stale_claim'

    const retry = input.temporary && message.attemptCount < options.maxAttempts
    const failureCode = retry ? input.code : input.temporary ? 'retry_exhausted' : input.code
    await tx.mailOutboxMessage.update({
      where: { id: input.id },
      data: retry
        ? {
            availableAt: new Date(
              input.now.getTime() + options.retryBaseMs * (2 ** (message.attemptCount - 1)),
            ),
            lastFailureCode: failureCode,
            leaseExpiresAt: null,
            leaseOwner: null,
            state: 'queued',
          }
        : {
            completedAt: input.now,
            lastFailureCode: failureCode,
            leaseExpiresAt: null,
            leaseOwner: null,
            recipient: '[redacted]',
            state: 'terminal_failure',
            templatePayload: {},
          },
    })
    await tx.mailDeliveryAttempt.create({
      data: {
        attemptedAt: input.now,
        failureCode,
        outcome: retry ? 'temporary_failure' : 'terminal_failure',
        outboxId: input.id,
      },
    })
    if (input.affectsCircuit) {
      const control = await tx.mailDeliveryControl.update({
        where: { id: DELIVERY_CONTROL_ID },
        data: { consecutiveFailures: { increment: 1 } },
      })
      if (control.consecutiveFailures >= options.circuitFailureThreshold) {
        await tx.mailDeliveryControl.update({
          where: { id: DELIVERY_CONTROL_ID },
          data: {
            circuitOpenUntil: new Date(input.now.getTime() + options.circuitOpenMs),
          },
        })
      }
    }
    return retry ? 'queued' : 'terminal_failure'
  })
}

async function releaseBlocked(
  db: DbClient,
  options: MailOutboxRepositoryOptions,
  input: { id: string; now: Date; workerId: string },
) {
  const result = await db.mailOutboxMessage.updateMany({
    where: { id: input.id, leaseOwner: input.workerId, state: 'leased' },
    data: {
      attemptCount: { decrement: 1 },
      availableAt: new Date(input.now.getTime() + options.circuitOpenMs),
      lastFailureCode: 'mail_service_blocked',
      leaseExpiresAt: null,
      leaseOwner: null,
      state: 'queued',
    },
  })
  return result.count === 1
}

async function ensureAndLockControl(tx: Prisma.TransactionClient, now: Date) {
  await tx.$executeRaw`
    INSERT INTO mail_delivery_controls (id, window_started_at, updated_at)
    VALUES (${DELIVERY_CONTROL_ID}, ${now}, ${now})
    ON CONFLICT (id) DO NOTHING
  `
  await tx.$queryRaw`
    SELECT id
    FROM mail_delivery_controls
    WHERE id = ${DELIVERY_CONTROL_ID}
    FOR UPDATE
  `
}

async function lockOutboxRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`
    SELECT id
    FROM mail_outbox_messages
    WHERE id = ${id}::uuid
    FOR UPDATE
  `
}
