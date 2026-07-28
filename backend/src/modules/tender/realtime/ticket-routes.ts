import { apiErrorSchema, realtimeTicketResponseSchema } from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import { emitSecurityEvent, type SecurityEventLogger } from '../../../security/events'
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
  issuer: RealtimeTicketIssuer
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  securityEvents: SecurityEventLogger
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.openapi(createRealtimeTicketRoute, async (c) => {
    const now = new Date()
    const ticket = `${crypto.randomUUID()}${crypto.randomUUID()}`
    const expiresAt = new Date(now.getTime() + 30_000)
    const result = await input.issuer.issue({
      expiresAt,
      now,
      sessionId: c.var.user.sessionId,
      ticketHash: hashRealtimeTicket(ticket),
      userId: c.var.user.id,
    })

    if (result.kind === 'limited') {
      c.header('Retry-After', String(result.retryAfterSeconds))
      emitSecurityEvent(c, input.securityEvents, {
        code: 'RATE_LIMITED',
        outcome: 'limited',
        reason: 'realtime_ticket_issue_budget',
        type: 'request_rejected',
      })
      return c.json({
        error: {
          code: 'RATE_LIMITED' as const,
          message: 'Too many realtime ticket requests',
        },
      }, 429)
    }

    return c.json({ expiresAt: expiresAt.toISOString(), ticket }, 201)
  })
  return routes
}
