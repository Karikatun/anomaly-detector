import type { DbClient } from '../../db'
import type { Context } from 'hono'
import type { RequestBudget } from '../../security/request-budget'
import type { RequestBudgetPolicyCatalog } from '../../security/request-budget-policy'
import { createPrismaAnalytics } from './infrastructure/prisma-analytics'
import { createAnalyticsRoutes } from './transport/routes'

export function createAnalyticsModule(input: {
  campaignAllowlist: ReadonlySet<string>
  clientAddress(context: Context): string
  cookieSecure: boolean
  db: DbClient
  fingerprintKey: string
  mode: 'aggregate' | 'consented'
  origins: ReadonlySet<string>
  requestBudget: RequestBudget
  requestBudgetPolicies: Pick<RequestBudgetPolicyCatalog, 'analytics_ingest' | 'analytics_consent'>
}) {
  const store = createPrismaAnalytics(input.db, {
    campaignAllowlist: input.campaignAllowlist,
    fingerprintKey: input.fingerprintKey,
    mode: input.mode,
  })
  return {
    routes: createAnalyticsRoutes({
      checkBudget: async (context) => {
        const key = input.clientAddress(context)
        const now = new Date()
        const result = await input.requestBudget.consume({ key, now, policy: input.requestBudgetPolicies.analytics_ingest })
        if (!result.allowed || !context.req.path.endsWith('/consent/allow')) return result
        return input.requestBudget.consume({ key, now, policy: input.requestBudgetPolicies.analytics_consent })
      },
      cookieSecure: input.cookieSecure,
      origins: input.origins,
      mode: input.mode,
      store,
    }),
    store,
  }
}

export { createPrismaAnalytics } from './infrastructure/prisma-analytics'
export { cleanupAnalyticsData } from './infrastructure/prisma-analytics-cleanup'
