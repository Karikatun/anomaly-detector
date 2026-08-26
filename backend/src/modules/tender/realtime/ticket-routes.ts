import { apiErrorSchema, realtimeTicketResponseSchema } from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { AppError, validationErrorHook } from '../../../http/errors'
import type { RequestBudget } from '../../../security/request-budget'
import type { RequestBudgetPolicy } from '../../../security/request-budget-policy'
import type { AuthHttpEnv } from '../../auth'
import { hashRealtimeTicket, type RealtimeTicketIssuer } from './tickets'

const createRealtimeTicketRoute = createRoute({
  method: 'post',
  path: '/tickets',
  responses: {
    201: { content: { 'application/json': { schema: realtimeTicketResponseSchema } }, description: 'One-time realtime ticket' },
    429: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Ticket issuance rate limited' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
  },
})

export function createRealtimeTicketRoutes(input: {
  authenticatedMutationBudget: MiddlewareHandler<AuthHttpEnv>
  issueBudget: RequestBudget
  issueBudgetPolicy: RequestBudgetPolicy<'realtime_ticket_issue'>
  issuer: RealtimeTicketIssuer
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.use('*', input.authenticatedMutationBudget)
  routes.use('/tickets', async (c, next) => {
    const result = await input.issueBudget.consume({
      key: c.var.user.id,
      now: new Date(),
      policy: input.issueBudgetPolicy,
    })
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSeconds))
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many realtime ticket requests',
        undefined,
        'realtime_ticket_issue_budget',
      )
    }
    await next()
  })
  routes.openapi(createRealtimeTicketRoute, async (c) => {
    const now = new Date()
    const ticket = `${crypto.randomUUID()}${crypto.randomUUID()}`
    const expiresAt = new Date(now.getTime() + 30_000)
    await input.issuer.issue({
      expiresAt,
      now,
      sessionId: c.var.user.sessionId,
      ticketHash: hashRealtimeTicket(ticket),
      userId: c.var.user.id,
    })

    return c.json({ expiresAt: expiresAt.toISOString(), ticket }, 201)
  })
  return routes
}
