import { adminOverviewQuerySchema, adminOverviewSchema } from '@anomaly-detector/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'

import { errorResponse } from '../../../http/errors'
import type { AuthenticatedPrincipal, AuthHttpEnv } from '../../auth'
import type { AdminOverviewReader } from '../application/ports'

type CreateAdminRoutesInput = {
  adminUserIds: ReadonlySet<string>
  authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  onAccessDenied?: (context: Context<AuthHttpEnv>, kind: 'authentication' | 'authorization') => void
  overviewReader: AdminOverviewReader
}

export function createAdminRoutes(input: CreateAdminRoutesInput) {
  const routes = new OpenAPIHono<AuthHttpEnv>()

  routes.use('*', async (c, next) => {
    let principal: AuthenticatedPrincipal
    try {
      principal = await input.authenticate(bearerToken(c.req.header('authorization')))
    } catch {
      input.onAccessDenied?.(c, 'authentication')
      return concealedNotFound(c)
    }

    if (!input.adminUserIds.has(principal.id)) {
      input.onAccessDenied?.(c, 'authorization')
      return concealedNotFound(c)
    }

    c.set('user', principal)
    await next()
  })

  // Intentionally use a plain route so the operator surface is not published in OpenAPI.
  routes.get('/overview', async (c) => {
    const query = adminOverviewQuerySchema.parse(c.req.query())
    const overview = adminOverviewSchema.parse(await input.overviewReader.read(query))
    c.header('Cache-Control', 'no-store')
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
    return c.json(overview)
  })

  return routes
}

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}

function concealedNotFound(c: Context<AuthHttpEnv>) {
  return c.json(errorResponse('NOT_FOUND', 'Route not found'), 404)
}
