import type { MiddlewareHandler } from 'hono'

import { AppError } from '../../../http/errors'
import type { RequestBudget } from '../../../security/request-budget'
import type { AuthHttpEnv } from './middleware'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createAuthenticatedMutationBudget(
  budget: RequestBudget,
): MiddlewareHandler<AuthHttpEnv> {
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) {
      await next()
      return
    }

    const result = await budget.consume({
      key: c.var.user.id,
      limit: 120,
      now: new Date(),
      scope: 'authenticated_mutation',
      windowMs: 60_000,
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
