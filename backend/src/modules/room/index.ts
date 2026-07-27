import type { DbClient } from '../../db'
import type { MiddlewareHandler } from 'hono'
import type { AuthHttpEnv } from '../auth'
import { TenderRoomService } from './application/room-service'
import { createPrismaRoomMemberIdentityReader } from './infrastructure/prisma-room-member-identity-reader'
import { createPrismaRoomRepository } from './infrastructure/prisma-room-repository'
import { createRoomStartModule } from './infrastructure/prisma-room-start'
import { createRoomRoutes } from './transport/routes'

export function createRoomModule(input: {
  db: DbClient
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const service = new TenderRoomService({
    memberIdentityReader: createPrismaRoomMemberIdentityReader(input.db),
    repository: createPrismaRoomRepository(input.db),
  })
  return {
    routes: createRoomRoutes({
      requireAuth: input.requireAuth,
      service,
    }),
  }
}

export { createRoomStartModule }
