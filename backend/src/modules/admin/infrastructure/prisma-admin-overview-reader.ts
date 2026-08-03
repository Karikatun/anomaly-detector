import type { AdminOverview } from '@anomaly-detector/contracts'

import type { DbClient } from '../../../db'
import type { AdminOverviewReader } from '../application/ports'

const roomStatuses = ['waiting', 'starting', 'started'] as const

export function createPrismaAdminOverviewReader(
  db: DbClient,
  now: () => Date = () => new Date(),
): AdminOverviewReader {
  return {
    async read(query): Promise<AdminOverview> {
      const generatedAt = now()
      const users = await db.user.count()
      const totalPages = Math.max(1, Math.ceil(users / query.pageSize))
      const page = Math.min(query.page, totalPages)
      const [
        activeSessions,
        rooms,
        tenders,
        roomGroups,
        tenderGroups,
        userItems,
      ] = await Promise.all([
        db.authSession.count({
          where: {
            expiresAt: { gt: generatedAt },
            revokedAt: null,
          },
        }),
        db.tenderRoom.count(),
        db.tender.count(),
        db.tenderRoom.groupBy({ by: ['status'], _count: { _all: true } }),
        db.tender.groupBy({ by: ['phase'], _count: { _all: true } }),
        db.user.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            login: true,
            displayName: true,
            createdAt: true,
          },
        }),
      ])

      const roomsByStatus = Object.fromEntries(roomStatuses.map((status) => [status, 0])) as Record<(typeof roomStatuses)[number], number>
      for (const group of roomGroups) {
        if (roomStatuses.includes(group.status as (typeof roomStatuses)[number])) {
          roomsByStatus[group.status as (typeof roomStatuses)[number]] = group._count._all
        }
      }

      return {
        generatedAt: generatedAt.toISOString(),
        totals: { users, activeSessions, rooms, tenders },
        roomsByStatus,
        tendersByPhase: tenderGroups
          .map((group) => ({ phase: group.phase, count: group._count._all }))
          .sort((left, right) => left.phase.localeCompare(right.phase)),
        users: {
          page,
          pageSize: query.pageSize,
          totalItems: users,
          totalPages,
          items: userItems.map((user) => ({
            ...user,
            createdAt: user.createdAt.toISOString(),
          })),
        },
      }
    },
  }
}
