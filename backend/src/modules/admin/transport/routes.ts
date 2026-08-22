import {
  adminOverviewQuerySchema,
  adminOverviewSchema,
  mailPolicyImportCommandSchema,
  mailPolicyPublishCommandSchema,
  mailPolicyStatusCommandSchema,
  mailOperationsViewSchema,
} from '@anomaly-detector/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'

import { errorResponse } from '../../../http/errors'
import type { AuthenticatedPrincipal, AuthHttpEnv } from '../../auth'
import { executeMailPolicy } from '../../mail'
import type { AdminMailPolicyOperator, AdminOverviewReader } from '../application/ports'

type CreateAdminRoutesInput = {
  adminUserIds: ReadonlySet<string>
  authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  mailPolicy: AdminMailPolicyOperator
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
    c.header('Cache-Control', 'no-store')
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
    await next()
  })

  // Intentionally use a plain route so the operator surface is not published in OpenAPI.
  routes.get('/overview', async (c) => {
    const query = adminOverviewQuerySchema.parse(c.req.query())
    const overview = adminOverviewSchema.parse(await input.overviewReader.read(query))
    return c.json(overview)
  })

  routes.get('/mail-policy', async (c) => {
    return c.json(mailOperationsViewSchema.parse(await input.mailPolicy.read()))
  })

  routes.post('/mail-policy/import', async (c) => {
    const command = mailPolicyImportCommandSchema.parse(await c.req.json())
    const result = await executeMailPolicy(() => input.mailPolicy.importCandidates(command, operator(c)))
    return c.json(mailOperationsViewSchema.parse(result))
  })

  routes.post('/mail-policy/publish', async (c) => {
    const command = mailPolicyPublishCommandSchema.parse(await c.req.json())
    const result = await executeMailPolicy(() => input.mailPolicy.publish(command, operator(c)))
    return c.json(mailOperationsViewSchema.parse(result))
  })

  routes.post('/mail-policy/status', async (c) => {
    const command = mailPolicyStatusCommandSchema.parse(await c.req.json())
    const result = await executeMailPolicy(() => input.mailPolicy.changeStatus(command, operator(c)))
    return c.json(mailOperationsViewSchema.parse(result))
  })

  return routes
}

function operator(c: Context<AuthHttpEnv>) {
  const principal = c.get('user')
  return { authenticatedAt: principal.authenticatedAt, id: principal.id }
}

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}

function concealedNotFound(c: Context<AuthHttpEnv>) {
  return c.json(errorResponse('NOT_FOUND', 'Route not found'), 404)
}
