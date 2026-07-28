import {
  apiErrorSchema,
  commandReceiptSchema,
  tenderCommandSchema,
  tenderIdSchema,
  tenderViewSchema,
} from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'

import { AppError, validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { createTenderModule } from '../index'
import { executeTender, executeTenderRead } from './errors'

const tenderParamsSchema = z.object({ tenderId: tenderIdSchema })

const readTenderRoute = createRoute({
  method: 'get',
  path: '/{tenderId}',
  request: { params: tenderParamsSchema },
  responses: {
    200: { content: { 'application/json': { schema: tenderViewSchema } }, description: 'Participant Tender view' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Tender not found' },
  },
})

const executeTenderCommandRoute = createRoute({
  method: 'post',
  path: '/{tenderId}/commands',
  request: {
    params: tenderParamsSchema,
    body: { content: { 'application/json': { schema: tenderCommandSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: commandReceiptSchema } }, description: 'Accepted Tender command' },
    400: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Invalid command' },
    401: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Authentication required' },
    403: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Command identity mismatch' },
    404: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Tender not found' },
    409: { content: { 'application/json': { schema: apiErrorSchema } }, description: 'Tender command conflict' },
  },
})

type TenderModule = ReturnType<typeof createTenderModule>

export function createTenderRoutes(input: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  tender: TenderModule
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.openapi(readTenderRoute, async (c) => c.json(
    await executeTenderRead(() => input.tender.readTenderView({
      playerId: c.var.user.id,
      tenderId: c.req.valid('param').tenderId,
    })),
    200,
  ))
  routes.openapi(executeTenderCommandRoute, async (c) => {
    const command = c.req.valid('json')
    const tenderId = c.req.valid('param').tenderId
    if (command.actorId !== c.var.user.id || command.tenderId !== tenderId) {
      throw new AppError(403, 'FORBIDDEN', 'Tender command identity does not match this request')
    }
    return c.json(await executeTender(() => input.tender.execute(command)), 200)
  })
  return routes
}
