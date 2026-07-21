import { apiErrorSchema, realtimeTicketResponseSchema } from '@the-game/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../../db'
import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'

const createRealtimeTicketRoute = createRoute({
  method: 'post',
  path: '/tickets',
  responses: {
    201: { content: { 'application/json': { schema: realtimeTicketResponseSchema } }, description: 'One-time realtime ticket' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
  },
})

export function createRealtimeTicketRoutes(input: { db: DbClient; requireAuth: MiddlewareHandler<AuthHttpEnv> }) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.openapi(createRealtimeTicketRoute, async (c) => {
    const ticket = `${crypto.randomUUID()}${crypto.randomUUID()}`
    const expiresAt = new Date(Date.now() + 30_000)
    await input.db.realtimeTicket.create({
      data: {
        expiresAt,
        sessionId: c.var.user.sessionId,
        ticketHash: await sha256(ticket),
        userId: c.var.user.id,
      },
    })
    return c.json({ expiresAt: expiresAt.toISOString(), ticket }, 201)
  })
  return routes
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
