import type { Context, MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import { FeedbackOperatorService } from './application/feedback-operator-service'
import { createPrismaFeedbackIntake } from './infrastructure/prisma-feedback-intake'
import { cleanupFeedbackReports } from './infrastructure/prisma-feedback-cleanup'
import { createPrismaFeedbackOperatorRepository } from './infrastructure/prisma-feedback-operator-repository'
import { createFeedbackRoutes } from './transport/routes'

export function createFeedbackModule(input: {
  authenticatedMutationBudget: MiddlewareHandler<AuthHttpEnv>
  clientAddress: (context: Context<AuthHttpEnv>) => string
  db: DbClient
  fingerprintKey: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const operator = new FeedbackOperatorService({
    clock: { now: () => new Date() },
    fingerprintKey: input.fingerprintKey,
    repository: createPrismaFeedbackOperatorRepository(input.db),
  })
  return {
    operator,
    routes: createFeedbackRoutes({
      authenticatedMutationBudget: input.authenticatedMutationBudget,
      clientAddress: input.clientAddress,
      intake: createPrismaFeedbackIntake(input.db, input.fingerprintKey),
      requireAuth: input.requireAuth,
    }),
  }
}

export { executeFeedbackOperator } from './transport/errors'
export { cleanupFeedbackReports }
