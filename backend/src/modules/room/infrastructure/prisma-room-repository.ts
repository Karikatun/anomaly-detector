import type { DbClient } from '../../../db'
import { createPersistentTenderModule } from '../../tender'
import type { RoomRepository } from '../application/ports'
import { RoomFailure } from '../domain/errors'

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

    async join(input) {
      return db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findUnique({
          where: { id: input.roomId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.members.some((member) => member.userId === input.actorId)) {
          // Already joined — return current room state (idempotent poll)
          return {
            capacity: room.capacity as 2 | 3 | 4,
            hostId: room.hostId,
            id: room.id,
            members: room.members.map((m) => ({ seat: m.seat, userId: m.userId })),
            status: room.status as 'waiting' | 'started',
            tenderId: room.tenderId,
          }
        }
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        if (room.members.length >= room.capacity) throw new RoomFailure('room_full', 'Room is already full')

        const occupiedSeats = new Set(room.members.map((member) => member.seat))
        const seat = Array.from({ length: room.capacity }, (_, index) => index + 1)
          .find((candidate) => !occupiedSeats.has(candidate))
        if (!seat) throw new RoomFailure('room_full', 'Room is already full')

        await tx.tenderRoomMember.create({
          data: { roomId: room.id, seat, userId: input.actorId },
        })
        return {
          capacity: room.capacity as 2 | 3 | 4,
          hostId: room.hostId,
          id: room.id,
          members: [...room.members, { seat, userId: input.actorId }]
            .sort((left, right) => left.seat - right.seat)
            .map((member) => ({ seat: member.seat, userId: member.userId })),
          status: 'waiting' as const,
          tenderId: room.tenderId,
        }
      }, { isolationLevel: 'Serializable' })
    },

    async leave(input) {
      await db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findUnique({
          where: { id: input.roomId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        if (!room.members.some((member) => member.userId === input.actorId)) {
          throw new RoomFailure('room_not_member', 'Player did not join this room')
        }

        const remainingMembers = room.members.filter((member) => member.userId !== input.actorId)
        if (remainingMembers.length === 0) {
          await tx.tenderRoom.delete({ where: { id: room.id } })
          return
        }

        await tx.tenderRoomMember.delete({
          where: { roomId_userId: { roomId: room.id, userId: input.actorId } },
        })
        if (room.hostId === input.actorId) {
          await tx.tenderRoom.update({
            where: { id: room.id },
            data: { hostId: remainingMembers[0].userId },
          })
        }
      }, { isolationLevel: 'Serializable' })
    },

    async start(input) {
      return db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findUnique({
          where: { id: input.roomId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.hostId !== input.actorId) throw new RoomFailure('room_not_host', 'Only the room host can start it')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room has already started')
        if (room.members.length !== room.capacity) throw new RoomFailure('room_full', 'Room needs every seat filled before starting')

        const tender = createPersistentTenderModule(tx as DbClient)
        const { tenderId } = await tender.createTender({
          players: room.members.map((member) => ({ id: member.userId, tiePriority: member.seat })),
        })
        const startedRoom = await tx.tenderRoom.update({
          where: { id: room.id },
          data: { status: 'started', tenderId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        return {
          capacity: startedRoom.capacity as 2 | 3 | 4,
          hostId: startedRoom.hostId,
          id: startedRoom.id,
          members: startedRoom.members.map((member) => ({ seat: member.seat, userId: member.userId })),
          status: 'started' as const,
          tenderId,
        }
      }, { isolationLevel: 'Serializable' })
    },
  }
}
