import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import { ProfileStatisticsService } from './application/profile-statistics-service'
import type { CompletedTenderSummaryReader } from './application/ports'
import { TutorialProgressService } from './application/tutorial-progress-service'
import { createPrismaTutorialProgressRepository } from './infrastructure/prisma-tutorial-progress-repository'
import { createProfileRoutes } from './transport/routes'

export function createProfileModule(input: {
  completedTenderSummaryReader: CompletedTenderSummaryReader
  db: DbClient
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const service = new ProfileStatisticsService({
    completedTenderSummaryReader: input.completedTenderSummaryReader,
  })
  const tutorial = new TutorialProgressService(
    createPrismaTutorialProgressRepository(input.db),
  )
  return {
    routes: createProfileRoutes({
      requireAuth: input.requireAuth,
      service,
      tutorial,
    }),
  }
}
