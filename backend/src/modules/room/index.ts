import type { DbClient } from '../../db'
import type { MiddlewareHandler } from 'hono'
import { createPrismaRequestBudget } from '../../security/request-budget'
import type { AuthHttpEnv } from '../auth'
import type { TenderModule } from '../tender'
import type { TenderLifecycleReader } from './application/ports'
import { TenderRoomService } from './application/room-service'
import { createPrismaRoomMemberIdentityReader } from './infrastructure/prisma-room-member-identity-reader'
import { createPrismaRoomRepository } from './infrastructure/prisma-room-repository'
import { createRoomStartModule } from './infrastructure/prisma-room-start'
import { createRoomRoutes } from './transport/routes'

export function createRoomModule(input: {
  authenticatedMutationBudget: MiddlewareHandler<AuthHttpEnv>
  db: DbClient
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  tender: Pick<TenderModule, 'readTenderPlacement'>
  tenderLifecycleReader: TenderLifecycleReader
}) {
  const clock = { now: () => new Date() }
  const service = new TenderRoomService({
    clock,
    matchPlacementReader: {
      readPlacement: (query) => input.tender.readTenderPlacement(query),
    },
    memberIdentityReader: createPrismaRoomMemberIdentityReader(input.db),
    repository: createPrismaRoomRepository(input.db, clock),
    tenderLifecycleReader: input.tenderLifecycleReader,
  })
  return {
    routes: createRoomRoutes({
      authenticatedMutationBudget: input.authenticatedMutationBudget,
      joinBudget: createPrismaRequestBudget(input.db),
      requireAuth: input.requireAuth,
      service,
    }),
  }
}

export { createRoomStartModule }
