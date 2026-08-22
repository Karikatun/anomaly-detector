import type { DbClient } from '../../../db'

const DAY_MS = 24 * 60 * 60 * 1_000

export function cleanupFeedbackReports(db: DbClient, now: Date) {
  const activeCutoff = new Date(now.getTime() - 180 * DAY_MS)
  const terminalCutoff = new Date(now.getTime() - 30 * DAY_MS)

  return db.feedbackReport.deleteMany({
    where: {
      OR: [
        {
          createdAt: { lte: activeCutoff },
          status: { in: ['new', 'in_review'] },
        },
        { resolvedAt: { lte: terminalCutoff } },
        { rejectedAt: { lte: terminalCutoff } },
        { transferredAt: { lte: terminalCutoff } },
      ],
    },
  })
}
