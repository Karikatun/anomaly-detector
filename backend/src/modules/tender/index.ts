import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../db'
import {
  createCompletedTenderSummaryReader,
  createTenderLifecycleReader,
} from './application/tender-readers'
import {
  createTenderService,
  type CreateTenderServiceOptions,
} from './application/tender-service'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'
import { createPrismaTenderStore } from './infrastructure/prisma-tender-store'

type CreateTenderModuleOptions = Partial<Omit<CreateTenderServiceOptions, 'store'>> & {
  store?: CreateTenderServiceOptions['store']
}

export function createTenderModule({
  now,
  onTenderChanged,
  seedGenerator = randomUUID,
  store = createInMemoryTenderStore(),
}: CreateTenderModuleOptions = {}) {
  return createTenderService({
    seedGenerator,
    store,
    ...(now ? { now } : {}),
    ...(onTenderChanged ? { onTenderChanged } : {}),
  })
}

export function createPersistentTenderModule(db: DbClient) {
  return createTenderModule({ store: createPrismaTenderStore(db) })
}

export function createPersistentCompletedTenderSummaryReader(db: DbClient) {
  const reader = createCompletedTenderSummaryReader(createPrismaTenderStore(db))
  return {
    listCompletedMatches: (playerId: string) => reader.listCompletedForPlayer(playerId),
  }
}

export function createPersistentTenderLifecycleReader(db: DbClient) {
  return createTenderLifecycleReader(createPrismaTenderStore(db))
}

export type { TenderModule } from './application/tender-module'

export { createTenderRoutes } from './transport/routes'
export { createRealtimeTicketRoutes } from './realtime/ticket-routes'
export { createRealtimeHub, type RealtimeHub } from './realtime/hub'
export { createPrismaRealtimeTicketIssuer } from './realtime/prisma-realtime-ticket-issuer'
export { createPrismaRealtimeTicketStore } from './realtime/prisma-realtime-ticket-store'
export { createPrismaTenderStore } from './infrastructure/prisma-tender-store'
export {
  createRealtimeWebSocketHandlers,
  upgradeRealtimeWebSocket,
  type RealtimeSocketData,
} from './realtime/websocket'
