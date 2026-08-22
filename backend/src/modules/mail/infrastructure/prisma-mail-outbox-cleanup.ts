import type { Prisma } from '../../../generated/prisma/client'

type MailOutboxCleanupDb = Pick<Prisma.TransactionClient, 'mailOutboxMessage'>

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
