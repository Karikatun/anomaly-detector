import type { Prisma } from '../../../generated/prisma/client'
import { transactionalMailPendingCutoff } from '../application/transactional-mail-retention'

type MailOutboxCleanupDb = Pick<
  Prisma.TransactionClient,
  'mailDeliveryAttempt' | 'mailOutboxMessage'
>

export async function cleanupExpiredPendingMailOutbox(
  db: MailOutboxCleanupDb,
  now: Date,
) {
  const expired = await db.mailOutboxMessage.updateManyAndReturn({
    where: {
      state: { in: ['queued', 'leased'] },
      OR: [
        {
          createdAt: { lte: transactionalMailPendingCutoff(now) },
          templateKind: 'security_notification',
        },
        {
          templateKind: {
            in: ['account_email_confirmation', 'password_recovery'],
          },
          templatePayload: {
            lte: now.toISOString(),
            path: ['expiresAt'],
          },
        },
      ],
    },
    data: {
      completedAt: now,
      lastFailureCode: 'retention_expired',
      leaseExpiresAt: null,
      leaseOwner: null,
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    },
    select: { id: true },
  })
  if (expired.length > 0) {
    await db.mailDeliveryAttempt.createMany({
      data: expired.map((message) => ({
        attemptedAt: now,
        failureCode: 'retention_expired',
        outcome: 'terminal_failure',
        outboxId: message.id,
      })),
    })
  }
  return { count: expired.length }
}

export function cleanupTerminalMailOutbox(
  db: MailOutboxCleanupDb,
  completedBefore: Date,
) {
  return db.mailOutboxMessage.deleteMany({
    where: {
      completedAt: { lt: completedBefore },
      state: { in: ['smtp_accepted', 'terminal_failure'] },
    },
  })
}
