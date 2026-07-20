import { apiErrorSchema, createRoomRequestSchema, roomViewSchema } from '@the-game/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import type { TenderRoomService } from '../application/room-service'
import type { AuthHttpEnv } from '../../auth'

const createRoomRoute = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: createRoomRequestSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Created private room' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
  },
})

export function createRoomRoutes(input: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: TenderRoomService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.openapi(createRoomRoute, async (c) => c.json(
    await input.service.createRoom({ ...c.req.valid('json'), hostId: c.var.user.id }),
    201,
  ))
  return routes
}
