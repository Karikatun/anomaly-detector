import { apiErrorSchema, createRoomRequestSchema, roomIdSchema, roomViewSchema } from '@the-game/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { TenderRoomService } from '../application/room-service'
import type { AuthHttpEnv } from '../../auth'
import { executeRoom } from './errors'

const createRoomRoute = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: createRoomRequestSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Created private room' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
  },
})

const joinRoomRoute = createRoute({
  method: 'post',
  path: '/{roomId}/join',
  request: { params: z.object({ roomId: roomIdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Joined private room' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room cannot be joined' },
  },
})

export function createRoomRoutes(input: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: TenderRoomService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.openapi(createRoomRoute, async (c) => c.json(
    await executeRoom(() => input.service.createRoom({ ...c.req.valid('json'), hostId: c.var.user.id })),
    201,
  ))
  routes.openapi(joinRoomRoute, async (c) => c.json(
    await executeRoom(() => input.service.joinRoom({ actorId: c.var.user.id, roomId: c.req.valid('param').roomId })),
    200,
  ))
  return routes
}
