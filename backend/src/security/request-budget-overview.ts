import type {
  RequestBudgetOverview,
  RequestBudgetSurface,
} from '@anomaly-detector/contracts'

import type { DbClient } from '../db'
import type { RequestBudgetPolicy } from './request-budget-policy'

const minimumGroupSize = 10
const roundingStep = 10
const surfaceOrder: readonly RequestBudgetSurface[] = [
  'authentication',
  'transactional_mail',
  'room_join',
  'tender_command',
  'realtime',
]

export type RequestBudgetOverviewReader = {
  read(now: Date): Promise<RequestBudgetOverview>
}

export function createRequestBudgetOverviewReader(
  db: DbClient,
  catalog: readonly RequestBudgetPolicy[],
): RequestBudgetOverviewReader {
  const policyByScope = new Map<string, RequestBudgetPolicy>(
    catalog
      .filter((policy) => policy.adminAggregation === 'authenticated_only')
      .map((policy) => [policy.scope, policy]),
  )
  const scopes = [...policyByScope.keys()]

  return {
    async read(now) {
      if (scopes.length === 0) return { groups: [], minimumGroupSize, roundingStep }

      const rows = await db.authAbuseBucket.groupBy({
        _count: { _all: true },
        by: ['scope', 'count'],
        where: {
          expiresAt: { gt: now },
          scope: { in: scopes },
        },
      })
      const aggregateByScope = new Map<string, {
        exhaustedBudgetKeys: number
        surface: RequestBudgetSurface
      }>()

      for (const row of rows) {
        const policy = policyByScope.get(row.scope)
        if (!policy || row.count < policy.limit) continue
        const aggregate = aggregateByScope.get(row.scope) ?? {
          exhaustedBudgetKeys: 0,
          surface: policy.surface,
        }
        aggregate.exhaustedBudgetKeys += row._count._all
        aggregateByScope.set(row.scope, aggregate)
      }

      const aggregateBySurface = new Map<RequestBudgetSurface, number>()
      for (const scopeAggregate of aggregateByScope.values()) {
        const roundedLowerBound = Math.floor(
          scopeAggregate.exhaustedBudgetKeys / roundingStep,
        ) * roundingStep
        if (roundedLowerBound < minimumGroupSize) continue
        aggregateBySurface.set(
          scopeAggregate.surface,
          (aggregateBySurface.get(scopeAggregate.surface) ?? 0) + roundedLowerBound,
        )
      }

      return {
        groups: surfaceOrder.flatMap((surface) => {
          const exhaustedBudgetKeysAtLeast = aggregateBySurface.get(surface)
          if (!exhaustedBudgetKeysAtLeast) return []
          return [{ exhaustedBudgetKeysAtLeast, surface }]
        }),
        minimumGroupSize,
        roundingStep,
      }
    },
  }
}
