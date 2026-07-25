import {
  apiErrorSchema,
  profileStatisticsSchema,
} from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { ProfileStatisticsService } from '../application/profile-statistics-service'

const statisticsRoute = createRoute({
  method: 'get',
  path: '/statistics',
  responses: {
    200: {
      content: { 'application/json': { schema: profileStatisticsSchema } },
      description: 'Aggregated completed-match statistics for the authenticated player',
    },
    401: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Authentication required',
    },
  },
})

export function createProfileRoutes(input: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: ProfileStatisticsService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.openapi(statisticsRoute, async (c) =>
    c.json(await input.service.read(c.var.user.id), 200))
  return routes
}
