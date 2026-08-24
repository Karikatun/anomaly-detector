import type { MiddlewareHandler } from 'hono'

import { AppError } from '../../../http/errors'
import type { RequestBudget } from '../../../security/request-budget'
import type { RequestBudgetPolicy } from '../../../security/request-budget-policy'
import type { AuthHttpEnv } from './middleware'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createAuthenticatedMutationBudget(
  budget: RequestBudget,
  policy: RequestBudgetPolicy<'authenticated_mutation'>,
): MiddlewareHandler<AuthHttpEnv> {
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) {
      await next()
      return
    }

    const result = await budget.consume({
      key: c.var.user.id,
      now: new Date(),
      policy,
    })
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSeconds))
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many authenticated mutation requests',
        undefined,
        'authenticated_mutation_budget',
      )
    }

    await next()
  }
}
