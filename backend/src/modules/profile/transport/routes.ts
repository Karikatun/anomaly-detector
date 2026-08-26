import {
  apiErrorSchema,
  profileStatisticsSchema,
  tutorialProgressSchema,
} from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { ProfileStatisticsService } from '../application/profile-statistics-service'
import type { TutorialProgressService } from '../application/tutorial-progress-service'

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

const tutorialRoute = createRoute({
  method: 'get',
  path: '/tutorial',
  responses: {
    200: {
      content: { 'application/json': { schema: tutorialProgressSchema } },
      description: 'Tutorial completion marker for the authenticated player',
    },
    401: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Authentication required',
    },
  },
})

const completeTutorialRoute = createRoute({
  method: 'put',
  path: '/tutorial/completion',
  responses: {
    200: {
      content: { 'application/json': { schema: tutorialProgressSchema } },
      description: 'Persisted tutorial completion marker',
    },
    401: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Authentication required',
    },
    429: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Authenticated mutation rate limited',
    },
  },
})

export function createProfileRoutes(input: {
  authenticatedMutationBudget: MiddlewareHandler<AuthHttpEnv>
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: ProfileStatisticsService
  tutorial: TutorialProgressService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.use('*', input.authenticatedMutationBudget)
  routes.openapi(statisticsRoute, async (c) =>
    c.json(await input.service.read(c.var.user.id), 200))
  routes.openapi(tutorialRoute, async (c) =>
    c.json(await input.tutorial.read(c.var.user.id), 200))
  routes.openapi(completeTutorialRoute, async (c) =>
    c.json(await input.tutorial.complete(c.var.user.id), 200))
  return routes
}
