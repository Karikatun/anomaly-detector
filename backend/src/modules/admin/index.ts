import type { DbClient } from '../../db'
import type { AuthenticatedPrincipal } from '../auth'
import { emitSecurityEvent, type SecurityEventLogger } from '../../security/events'
import type {
  AdminAnalyticsReader,
  AdminFeedbackOperator,
  AdminMailPolicyOperator,
  AdminOverviewReader,
  AdminRequestBudgetOverviewReader,
} from './application/ports'
import { createPrismaAdminOverviewReader } from './infrastructure/prisma-admin-overview-reader'
import { createAdminRoutes } from './transport/routes'

type CreateAdminModuleInput = {
  adminUserIds: ReadonlySet<string>
  analyticsReader?: AdminAnalyticsReader
  authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  feedback: AdminFeedbackOperator
  mailPolicy: AdminMailPolicyOperator
  requestBudgetOverviewReader: AdminRequestBudgetOverviewReader
  securityEvents?: SecurityEventLogger
} & (
  | { db: DbClient; overviewReader?: never }
  | { db?: never; overviewReader: AdminOverviewReader }
)

export function createAdminModule(input: CreateAdminModuleInput) {
  const overviewReader = input.overviewReader ?? createPrismaAdminOverviewReader(input.db)

  return {
    routes: createAdminRoutes({
      adminUserIds: input.adminUserIds,
      analyticsReader: input.analyticsReader,
      authenticate: input.authenticate,
      feedback: input.feedback,
      mailPolicy: input.mailPolicy,
      onAccessDenied: input.securityEvents
        ? (context, kind) => emitSecurityEvent(context, input.securityEvents!, {
            code: 'NOT_FOUND',
            outcome: 'denied',
            reason: 'operations_access_concealed',
            type: kind === 'authentication' ? 'authentication_rejected' : 'authorization_rejected',
          })
        : undefined,
      overviewReader,
      requestBudgetOverviewReader: input.requestBudgetOverviewReader,
    }),
  }
}
