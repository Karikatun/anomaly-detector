import {
  apiErrorSchema,
  createRoomRequestSchema,
  currentMatchResponseSchema,
  joinRoomByCodeRequestSchema,
  myMatchesResponseSchema,
  roomIdSchema,
  roomViewSchema,
  setRoomReadyRequestSchema,
} from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { AppError, validationErrorHook } from '../../../http/errors'
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

const listMatchesRoute = createRoute({
  method: 'get',
  path: '/mine',
  responses: {
    200: { content: { 'application/json': { schema: myMatchesResponseSchema } }, description: 'Started Tenders for the authenticated player' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
  },
})

const currentMatchRoute = createRoute({
  method: 'get',
  path: '/current',
  responses: {
    200: {
      content: { 'application/json': { schema: currentMatchResponseSchema } },
      description: 'Current unfinished Room for the authenticated player',
    },
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
    429: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Too many join attempts' },
  },
})

const joinRoomByCodeRoute = createRoute({
  method: 'post',
  path: '/join',
  request: { body: { content: { 'application/json': { schema: joinRoomByCodeRequestSchema } } } },
  responses: {
    200: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Joined private room by public code' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room cannot be joined' },
  },
})

const getRoomRoute = createRoute({
  method: 'get',
  path: '/{roomId}',
  request: { params: z.object({ roomId: roomIdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Current room state for a member' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Player is not a room member' },
  },
})

const leaveRoomRoute = createRoute({
  method: 'post',
  path: '/{roomId}/leave',
  request: { params: z.object({ roomId: roomIdSchema }) },
  responses: {
    204: { description: 'Left private room' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room cannot be left' },
  },
})

const startRoomRoute = createRoute({
  method: 'post',
  path: '/{roomId}/start',
  request: { params: z.object({ roomId: roomIdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Started Tender room' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room cannot be started' },
  },
})

const setRoomReadyRoute = createRoute({
  method: 'post',
  path: '/{roomId}/ready',
  request: {
    params: z.object({ roomId: roomIdSchema }),
    body: { content: { 'application/json': { schema: setRoomReadyRequestSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Updated player readiness' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Readiness cannot be changed' },
  },
})

const cancelRoomStartRoute = createRoute({
  method: 'post',
  path: '/{roomId}/cancel-start',
  request: { params: z.object({ roomId: roomIdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: roomViewSchema } }, description: 'Cancelled Tender room start' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Room start cannot be cancelled' },
  },
})

export function createRoomRoutes(input: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: TenderRoomService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  const joinAttempts = new Map<string, { count: number; resetAt: number }>()
  routes.use('*', input.requireAuth)
  routes.openapi(listMatchesRoute, async (c) => c.json({ matches: await executeRoom(() => input.service.listMatches(c.var.user.id)) }, 200))
  routes.openapi(currentMatchRoute, async (c) => c.json({
    match: await executeRoom(() => input.service.getCurrentMatch(c.var.user.id)),
  }, 200))
  routes.openapi(createRoomRoute, async (c) => c.json(
    await executeRoom(() => input.service.createRoom({ ...c.req.valid('json'), hostId: c.var.user.id })),
    201,
  ))
  routes.openapi(joinRoomByCodeRoute, async (c) => {
    const now = Date.now()
    const previous = joinAttempts.get(c.var.user.id)
    const bucket = !previous || previous.resetAt <= now
      ? { count: 1, resetAt: now + 60_000 }
      : { ...previous, count: previous.count + 1 }
    joinAttempts.set(c.var.user.id, bucket)
    if (joinAttempts.size > 10_000) {
      for (const [userId, attempt] of joinAttempts) {
        if (attempt.resetAt <= now) joinAttempts.delete(userId)
      }
      if (joinAttempts.size > 10_000) {
        const oldestUserId = joinAttempts.keys().next().value
        if (oldestUserId) joinAttempts.delete(oldestUserId)
      }
    }
    if (bucket.count > 20) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many room join attempts')
    }
    return c.json(await executeRoom(() => input.service.joinRoomByCode({
      actorId: c.var.user.id,
      code: c.req.valid('json').code,
    })), 200)
  })
  routes.openapi(getRoomRoute, async (c) => c.json(
    await executeRoom(() => input.service.getRoom({
      actorId: c.var.user.id,
      roomId: c.req.valid('param').roomId,
    })),
    200,
  ))
  routes.openapi(joinRoomRoute, async (c) => c.json(
    await executeRoom(() => input.service.joinRoom({ actorId: c.var.user.id, roomId: c.req.valid('param').roomId })),
    200,
  ))
  routes.openapi(leaveRoomRoute, async (c) => {
    await executeRoom(() => input.service.leaveRoom({ actorId: c.var.user.id, roomId: c.req.valid('param').roomId }))
    return c.body(null, 204)
  })
  routes.openapi(setRoomReadyRoute, async (c) => c.json(
    await executeRoom(() => input.service.setReady({
      actorId: c.var.user.id,
      ready: c.req.valid('json').ready,
      roomId: c.req.valid('param').roomId,
    })),
    200,
  ))
  routes.openapi(startRoomRoute, async (c) => c.json(
    await executeRoom(() => input.service.startRoom({ actorId: c.var.user.id, roomId: c.req.valid('param').roomId })),
    200,
  ))
  routes.openapi(cancelRoomStartRoute, async (c) => c.json(
    await executeRoom(() => input.service.cancelRoomStart({ actorId: c.var.user.id, roomId: c.req.valid('param').roomId })),
    200,
  ))
  return routes
}
