import type { DbClient } from '../../db'
import { createPrismaAnalytics } from './infrastructure/prisma-analytics'
import { createAnalyticsRoutes } from './transport/routes'

export function createAnalyticsModule(input: {
  campaignAllowlist: ReadonlySet<string>
  cookieSecure: boolean
  db: DbClient
  fingerprintKey: string
}) {
  const store = createPrismaAnalytics(input.db, {
    campaignAllowlist: input.campaignAllowlist,
    fingerprintKey: input.fingerprintKey,
  })
  return {
    routes: createAnalyticsRoutes({ cookieSecure: input.cookieSecure, store }),
    store,
  }
}

export { createPrismaAnalytics } from './infrastructure/prisma-analytics'
export { cleanupAnalyticsData } from './infrastructure/prisma-analytics-cleanup'
