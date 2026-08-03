import type { DbClient } from '../../db'
import type { AuthenticatedPrincipal } from '../auth'
import { emitSecurityEvent, type SecurityEventLogger } from '../../security/events'
import type { AdminOverviewReader } from './application/ports'
import { createPrismaAdminOverviewReader } from './infrastructure/prisma-admin-overview-reader'
import { createAdminRoutes } from './transport/routes'

type CreateAdminModuleInput = {
  adminUserIds: ReadonlySet<string>
  authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
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
      authenticate: input.authenticate,
      onAccessDenied: input.securityEvents
        ? (context, kind) => emitSecurityEvent(context, input.securityEvents!, {
            code: 'NOT_FOUND',
            outcome: 'denied',
            reason: 'operations_access_concealed',
            type: kind === 'authentication' ? 'authentication_rejected' : 'authorization_rejected',
          })
        : undefined,
      overviewReader,
    }),
  }
}
