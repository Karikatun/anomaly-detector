import type { DbClient } from '../../../db'
import type { RoomRepository } from '../application/ports'

export function createPrismaRoomRepository(db: DbClient): RoomRepository {
  return {
    async create(input) {
      const room = await db.tenderRoom.create({
        data: {
          capacity: input.capacity,
          hostId: input.hostId,
          status: 'waiting',
          members: {
            create: { seat: 1, userId: input.hostId },
          },
        },
        include: {
          members: { orderBy: { seat: 'asc' } },
        },
      })
      return {
        capacity: room.capacity as 2 | 3 | 4,
        hostId: room.hostId,
        id: room.id,
        members: room.members.map((member) => ({ seat: member.seat, userId: member.userId })),
        status: 'waiting',
        tenderId: room.tenderId,
      }
    },
  }
}
