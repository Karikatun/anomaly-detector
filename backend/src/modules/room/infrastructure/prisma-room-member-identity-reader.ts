import type { DbClient } from '../../../db'
import type { RoomMemberIdentityReader } from '../application/ports'

export function createPrismaRoomMemberIdentityReader(db: DbClient): RoomMemberIdentityReader {
  return {
    async readDisplayNames(userIds) {
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { displayName: true, id: true },
      })
      return new Map(users.map((user) => [user.id, user.displayName ?? 'Исследователь']))
    },
  }
}
