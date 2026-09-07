import {
  apiErrorSchema,
  feedbackIntakeCompatibilityRequestSchema,
  feedbackIntakeRequestSchema,
  feedbackReceiptSchema,
} from '@anomaly-detector/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context, MiddlewareHandler } from 'hono'

import { AppError, validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { FeedbackIntake } from '../application/ports'

const submitRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: {
      content: { 'application/json': { schema: feedbackIntakeCompatibilityRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: feedbackReceiptSchema } },
      description: 'Accepted product-owned feedback report receipt',
    },
    400: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Invalid report payload',
    },
    401: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Authentication required',
    },
    409: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Submission identifier conflicts with its first use',
    },
    429: {
      content: { 'application/json': { schema: apiErrorSchema } },
      description: 'Daily feedback budget exhausted',
    },
  },
})

export function createFeedbackRoutes(input: {
  authenticatedMutationBudget: MiddlewareHandler<AuthHttpEnv>
  clientAddress: (context: Context<AuthHttpEnv>) => string
  intake: FeedbackIntake
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('*', input.requireAuth)
  routes.use('*', input.authenticatedMutationBudget)
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.openapi(submitRoute, async (c) => {
    const submittedReport = c.req.valid('json')
    const report = feedbackIntakeRequestSchema.parse({
      ...submittedReport,
      submissionId: submittedReport.submissionId ?? crypto.randomUUID(),
    })
    const result = await input.intake.submit({
      clientAddress: input.clientAddress(c),
      report,
      userId: c.var.user.id,
    })
    if (result.kind === 'rate_limited') {
      c.header('Retry-After', String(result.retryAfterSeconds))
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Daily feedback report limit reached',
        undefined,
        'feedback_daily_budget',
      )
    }
    if (result.kind === 'submission_conflict') {
      throw new AppError(
        409,
        'CONFLICT',
        'Feedback submission identifier conflicts with its first use',
      )
    }
    if (result.kind === 'account_unavailable') {
      throw new AppError(
        409,
        'CONFLICT',
        'Account is unavailable for feedback linkage',
      )
    }

    return c.json(feedbackReceiptSchema.parse(result.receipt), 201)
  })

  return routes
}
