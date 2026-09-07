import type { DbClient } from '../../../db'

export type MailProtectionAlertOperationalState = {
  leased: number
  nextAttemptAt: Date | null
  oldestPendingAt: Date | null
  pending: number
  retrying: number
  terminal: number
}

export type MailProtectionAlertStateReader = {
  read(now: Date): Promise<MailProtectionAlertOperationalState>
}

type RawMailProtectionAlertOperationalState = {
  leased: number
  next_attempt_at: Date | null
  oldest_pending_at: Date | null
  pending: number
  retrying: number
  terminal: number
}

export function createPrismaMailProtectionAlertStateReader(
  db: DbClient,
): MailProtectionAlertStateReader {
  return {
    async read(now) {
      const rows = await db.$queryRaw<RawMailProtectionAlertOperationalState[]>`
        SELECT
          COUNT(*) FILTER (
            WHERE delivered_at IS NULL AND terminal_at IS NULL
          )::int AS pending,
          COUNT(*) FILTER (
            WHERE delivered_at IS NULL
              AND terminal_at IS NULL
              AND lease_expires_at > ${now}
          )::int AS leased,
          COUNT(*) FILTER (
            WHERE delivered_at IS NULL
              AND terminal_at IS NULL
              AND last_failure_code IS NOT NULL
          )::int AS retrying,
          COUNT(*) FILTER (
            WHERE delivered_at IS NULL AND terminal_at IS NOT NULL
          )::int AS terminal,
          MIN(occurred_at) FILTER (
            WHERE delivered_at IS NULL AND terminal_at IS NULL
          ) AS oldest_pending_at,
          MIN(available_at) FILTER (
            WHERE delivered_at IS NULL
              AND terminal_at IS NULL
              AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
          ) AS next_attempt_at
        FROM mail_delivery_protection_alerts
      `
      const state = rows[0]
      return {
        leased: state?.leased ?? 0,
        nextAttemptAt: state?.next_attempt_at ?? null,
        oldestPendingAt: state?.oldest_pending_at ?? null,
        pending: state?.pending ?? 0,
        retrying: state?.retrying ?? 0,
        terminal: state?.terminal ?? 0,
      }
    },
  }
}
