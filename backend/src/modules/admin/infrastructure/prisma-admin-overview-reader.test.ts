import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaAdminOverviewReader } from './prisma-admin-overview-reader'

test('groups countdown rooms with active games and separates completed games', async () => {
  let completedRoomQuery: unknown
  const db = {
    authSession: { count: async () => 3 },
    tenderRoom: {
      count: async (query?: unknown) => {
        if (!query) return 10
        completedRoomQuery = query
        return 4
      },
      groupBy: async () => [
        { status: 'waiting', _count: { _all: 2 } },
        { status: 'starting', _count: { _all: 1 } },
        { status: 'started', _count: { _all: 7 } },
      ],
    },
    tender: {
      count: async () => 8,
      groupBy: async () => [],
    },
    user: {
      count: async () => 0,
      findMany: async () => [],
    },
  } as unknown as DbClient

  const overview = await createPrismaAdminOverviewReader(
    db,
    () => new Date('2026-08-03T12:00:00.000Z'),
  ).read({ page: 1, pageSize: 20 })

  expect(overview.roomsByStatus).toEqual({
    waiting: 2,
    active: 4,
    completed: 4,
  })
  expect(completedRoomQuery).toEqual({
    where: {
      status: 'started',
      tender: { is: { phase: 'complete' } },
    },
  })
})
