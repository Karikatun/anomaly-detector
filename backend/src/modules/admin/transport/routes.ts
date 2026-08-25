import {
  analyticsAdminOverviewSchema,
  analyticsAdminQuerySchema,
  adminOverviewQuerySchema,
  adminOverviewSchema,
  feedbackDeleteContactCommandSchema,
  feedbackOperatorCommandResponseSchema,
  feedbackQueueQuerySchema,
  feedbackQueueResponseSchema,
  feedbackRecordGithubIssueCommandSchema,
  feedbackRejectCommandSchema,
  feedbackResolveCommandSchema,
  feedbackTakeCommandSchema,
  mailPolicySyncCommandSchema,
  mailPolicyStatusCommandSchema,
  mailOperationsViewSchema,
  requestBudgetOverviewSchema,
} from '@anomaly-detector/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'

import { AppError, errorResponse } from '../../../http/errors'
import type { AuthenticatedPrincipal, AuthHttpEnv } from '../../auth'
import { executeFeedbackOperator } from '../../feedback'
import { executeMailPolicy } from '../../mail'
import type {
  AdminAnalyticsReader,
  AdminFeedbackOperator,
  AdminMailPolicyOperator,
  AdminOverviewReader,
  AdminRequestBudgetOverviewReader,
} from '../application/ports'

type CreateAdminRoutesInput = {
  adminUserIds: ReadonlySet<string>
  analyticsReader?: AdminAnalyticsReader
  authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  feedback: AdminFeedbackOperator
  mailPolicy: AdminMailPolicyOperator
  onAccessDenied?: (context: Context<AuthHttpEnv>, kind: 'authentication' | 'authorization') => void
  overviewReader: AdminOverviewReader
  requestBudgetOverviewReader: AdminRequestBudgetOverviewReader
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

  if (input.analyticsReader) {
    routes.get('/analytics', async (c) => {
      const query = analyticsAdminQuerySchema.parse(c.req.query())
      return c.json(analyticsAdminOverviewSchema.parse(await input.analyticsReader!.read(query)))
    })
  }

  routes.get('/mail-policy', async (c) => {
    return c.json(mailOperationsViewSchema.parse(await input.mailPolicy.read()))
  })

  // Intentionally use a plain route so the operator surface is not published in OpenAPI.
  routes.get('/mail-policy/anti-abuse', async (c) => c.json(
    requestBudgetOverviewSchema.parse(await input.requestBudgetOverviewReader.read(new Date())),
  ))

  routes.get('/feedback', async (c) => {
    const query = feedbackQueueQuerySchema.parse(c.req.query())
    return c.json(feedbackQueueResponseSchema.parse(await input.feedback.read(query)))
  })

  routes.post('/feedback/:reportId/take', async (c) => {
    const command = feedbackTakeCommandSchema.parse(await c.req.json())
    return feedbackCommandResponse(c, input.feedback.take(command, operator(c), reportId(c)))
  })

  routes.post('/feedback/:reportId/resolve', async (c) => {
    const command = feedbackResolveCommandSchema.parse(await c.req.json())
    return feedbackCommandResponse(c, input.feedback.resolve(command, operator(c), reportId(c)))
  })

  routes.post('/feedback/:reportId/reject', async (c) => {
    const command = feedbackRejectCommandSchema.parse(await c.req.json())
    return feedbackCommandResponse(c, input.feedback.reject(command, operator(c), reportId(c)))
  })

  routes.post('/feedback/:reportId/github-issue', async (c) => {
    const command = feedbackRecordGithubIssueCommandSchema.parse(await c.req.json())
    return feedbackCommandResponse(
      c,
      input.feedback.recordGithubIssue(command, operator(c), reportId(c)),
    )
  })

  routes.post('/feedback/:reportId/contact/delete', async (c) => {
    const command = feedbackDeleteContactCommandSchema.parse(await c.req.json())
    return feedbackCommandResponse(c, input.feedback.deleteContact(command, operator(c), reportId(c)))
  })

  routes.post('/mail-policy/sync', async (c) => {
    const command = mailPolicySyncCommandSchema.parse(await c.req.json())
    const result = await executeMailPolicy(() => input.mailPolicy.syncCatalog(command, operator(c)))
    return c.json(mailOperationsViewSchema.parse(result))
  })

  routes.post('/mail-policy/status', async (c) => {
    const command = mailPolicyStatusCommandSchema.parse(await c.req.json())
    const result = await executeMailPolicy(() => input.mailPolicy.changeStatus(command, operator(c)))
    return c.json(mailOperationsViewSchema.parse(result))
  })

  return routes
}

async function feedbackCommandResponse(
  c: Context<AuthHttpEnv>,
  operation: Promise<unknown>,
) {
  const result = await executeFeedbackOperator(() => operation)
  return c.json(feedbackOperatorCommandResponseSchema.parse(result))
}

function reportId(c: Context<AuthHttpEnv>) {
  const value = c.req.param('reportId')
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(400, 'BAD_REQUEST', 'Invalid feedback report identifier')
  }
  return value
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
