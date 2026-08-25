import type { DbClient } from '../../../db'
import type {
  TenderOperationalState,
  TenderOperationalStateReader,
} from '../application/tender-operational-state'

type TenderOperationalStateRow = {
  active: bigint
  completed: bigint
  early_finished: bigint
  overdue: bigint
}

export function createPrismaTenderOperationalStateReader(
  db: DbClient,
): TenderOperationalStateReader {
  return {
    async read(now): Promise<TenderOperationalState> {
      const rows = await db.$queryRaw<TenderOperationalStateRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE phase <> 'complete')::bigint AS active,
          COUNT(*) FILTER (WHERE phase = 'complete')::bigint AS completed,
          COUNT(*) FILTER (
            WHERE phase = 'complete'
              AND state ->> 'completionReason' IN (
                'all_players_left',
                'all_players_forfeited',
                'last_active_player'
              )
          )::bigint AS early_finished,
          COUNT(*) FILTER (
            WHERE phase <> 'complete'
              AND (due_at <= ${now} OR abandonment_due_at <= ${now})
          )::bigint AS overdue
        FROM tenders
      `
      const row = rows[0]
      if (!row) throw new Error('Invalid Tender operational state')

      return {
        active: safeCount(row.active),
        completed: safeCount(row.completed),
        earlyFinished: safeCount(row.early_finished),
        overdue: safeCount(row.overdue),
      }
    },
  }
}

function safeCount(value: bigint) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid Tender operational state')
  }
  return count
}
