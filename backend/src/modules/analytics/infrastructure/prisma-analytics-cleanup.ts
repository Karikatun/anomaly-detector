import type { DbClient } from '../../../db'

const AGGREGATE_RETENTION_MONTHS = 13

export async function cleanupAnalyticsData(db: DbClient, now: Date) {
  const aggregateCutoff = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - AGGREGATE_RETENTION_MONTHS,
    now.getUTCDate(),
  ))
  const [journeys, aggregates] = await Promise.all([
    db.analyticsJourney.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.analyticsDailyAggregate.deleteMany({ where: { day: { lt: aggregateCutoff } } }),
  ])
  return { aggregates: aggregates.count, journeys: journeys.count }
}
