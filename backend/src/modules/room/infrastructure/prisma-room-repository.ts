import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import type { RoomRepository } from '../application/ports'
import { RoomFailure } from '../domain/errors'

export function createPrismaRoomRepository(db: DbClient): RoomRepository {
  return {
    async cancelStart(input) {
      return db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findUnique({
          where: { id: input.roomId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.hostId !== input.actorId) throw new RoomFailure('room_not_host', 'Only the room host can cancel its start')
        if (room.status !== 'starting') throw new RoomFailure('room_not_joinable', 'Room is not starting')

        const waitingRoom = await tx.tenderRoom.update({
          where: { id: room.id },
          data: { status: 'waiting', startsAt: null },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        return {
          capacity: waitingRoom.capacity as 2 | 3 | 4,
          hostId: waitingRoom.hostId,
          id: waitingRoom.id,
          members: waitingRoom.members.map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
          status: 'waiting' as const,
          startsAt: null,
          tenderId: waitingRoom.tenderId,
        }
      }, { isolationLevel: 'Serializable' })
    },
    async listStartedForMember(userId) {
      const rooms = await db.tenderRoom.findMany({
        where: { members: { some: { userId } }, status: 'started' },
        include: { members: { orderBy: { seat: 'asc' } }, tender: { select: { phase: true, state: true } } },
        orderBy: { updatedAt: 'desc' },
      })
      return rooms.map((room) => ({
        capacity: room.capacity as 2 | 3 | 4,
        hostId: room.hostId,
        id: room.id,
        members: room.members.map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
        status: 'started' as const,
        startsAt: null,
        tenderId: room.tenderId,
        tenderCompletionReason: readTenderCompletionReason(room.tender?.state),
        tenderPhase: room.tender?.phase,
      }))
    },
    async readCurrentForMember(userId) {
      return db.$transaction(async (tx) => {
        const current = await tx.currentMatch.findUnique({
          where: { userId },
          include: {
            room: {
              include: {
                members: { orderBy: { seat: 'asc' } },
                tender: { select: { phase: true, state: true } },
              },
            },
          },
        })
        if (!current) return null
        if (current.room.tender?.phase === 'complete') {
          await tx.currentMatch.delete({ where: { userId } })
          return null
        }
        return {
          capacity: current.room.capacity as 2 | 3 | 4,
          hostId: current.room.hostId,
          id: current.room.id,
          members: current.room.members.map((member) => ({
            ready: member.ready,
            seat: member.seat,
            userId: member.userId,
          })),
          status: current.room.status as 'waiting' | 'starting' | 'started',
          startsAt: current.room.startsAt?.toISOString() ?? null,
          tenderId: current.room.tenderId,
          tenderCompletionReason: readTenderCompletionReason(current.room.tender?.state),
          tenderPhase: current.room.tender?.phase,
        }
      }, { isolationLevel: 'Serializable' })
    },
    async readForMember(input) {
      const room = await db.tenderRoom.findUnique({
        where: { id: input.roomId },
        include: {
          members: { orderBy: { seat: 'asc' } },
          tender: { select: { phase: true, state: true } },
        },
      })
      if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
      if (!room.members.some((member) => member.userId === input.actorId)) {
        throw new RoomFailure('room_not_member', 'Player did not join this room')
      }
      return {
        capacity: room.capacity as 2 | 3 | 4,
        hostId: room.hostId,
        id: room.id,
        members: room.members.map((member) => ({
          ready: member.ready,
          seat: member.seat,
          userId: member.userId,
        })),
        status: room.status as 'waiting' | 'starting' | 'started',
        startsAt: room.startsAt?.toISOString() ?? null,
        tenderId: room.tenderId,
        tenderCompletionReason: readTenderCompletionReason(room.tender?.state),
        tenderPhase: room.tender?.phase,
      }
    },
    async create(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            await releaseCompletedCurrentMatch(tx, input.hostId)
            if (await tx.currentMatch.findUnique({ where: { userId: input.hostId } })) {
              throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
            }
            const room = await tx.tenderRoom.create({
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
            await tx.currentMatch.create({
              data: { roomId: room.id, userId: input.hostId },
            })
            return {
              capacity: room.capacity as 2 | 3 | 4,
              hostId: room.hostId,
              id: room.id,
              members: room.members.map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
              status: 'waiting' as const,
              startsAt: null,
              tenderId: room.tenderId,
            }
          }, { isolationLevel: 'Serializable' })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) continue
          if (isCurrentMatchUniqueConstraintError(error)) {
            throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
          }
          throw error
        }
      }
      throw new Error('Unreachable room creation transaction retry state')
    },

    async join(input) {
      try {
        return await db.$transaction(async (tx) => {
          await releaseCompletedCurrentMatch(tx, input.actorId)
          const currentMatch = await tx.currentMatch.findUnique({
            where: { userId: input.actorId },
            select: { roomId: true },
          })
          if (currentMatch && currentMatch.roomId !== input.roomId) {
            throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
          }
          const room = await tx.tenderRoom.findUnique({
            where: { id: input.roomId },
            include: { members: { orderBy: { seat: 'asc' } } },
          })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.members.some((member) => member.userId === input.actorId)) {
          if (!currentMatch) {
            await tx.currentMatch.create({
              data: { roomId: room.id, userId: input.actorId },
            })
          }
          // Already joined — return current room state (idempotent poll)
          return {
            capacity: room.capacity as 2 | 3 | 4,
            hostId: room.hostId,
            id: room.id,
            members: room.members.map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
            status: room.status as 'waiting' | 'starting' | 'started',
            startsAt: room.startsAt?.toISOString() ?? null,
            tenderId: room.tenderId,
          }
        }
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        if (room.members.length >= room.capacity) throw new RoomFailure('room_full', 'Room is already full')

        const occupiedSeats = new Set(room.members.map((member) => member.seat))
        const seat = Array.from({ length: room.capacity }, (_, index) => index + 1)
          .find((candidate) => !occupiedSeats.has(candidate))
        if (!seat) throw new RoomFailure('room_full', 'Room is already full')

        await tx.tenderRoomMember.updateMany({
          where: { roomId: room.id },
          data: { ready: false },
        })
        await tx.tenderRoomMember.create({
          data: { roomId: room.id, seat, userId: input.actorId },
        })
        await tx.currentMatch.create({
          data: { roomId: room.id, userId: input.actorId },
        })
        return {
          capacity: room.capacity as 2 | 3 | 4,
          hostId: room.hostId,
          id: room.id,
          members: [
            ...room.members.map((member) => ({ ...member, ready: false })),
            { ready: false, seat, userId: input.actorId },
          ]
            .sort((left, right) => left.seat - right.seat)
            .map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
          status: 'waiting' as const,
          startsAt: null,
          tenderId: room.tenderId,
        }
        }, { isolationLevel: 'Serializable' })
      } catch (error) {
        if (isCurrentMatchUniqueConstraintError(error)) {
          throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
        }
        throw error
      }
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

        await tx.currentMatch.deleteMany({
          where: { roomId: room.id, userId: input.actorId },
        })
        await tx.tenderRoomMember.delete({
          where: { roomId_userId: { roomId: room.id, userId: input.actorId } },
        })
        await tx.tenderRoomMember.updateMany({
          where: { roomId: room.id },
          data: { ready: false },
        })
        if (room.hostId === input.actorId) {
          await tx.tenderRoom.update({
            where: { id: room.id },
            data: { hostId: remainingMembers[0].userId },
          })
        }
      }, { isolationLevel: 'Serializable' })
    },

    async setReady(input) {
      return db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findUnique({
          where: { id: input.roomId },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        if (!room.members.some((member) => member.userId === input.actorId)) {
          throw new RoomFailure('room_not_member', 'Player did not join this room')
        }

        const updatedMember = await tx.tenderRoomMember.update({
          where: { roomId_userId: { roomId: room.id, userId: input.actorId } },
          data: { ready: input.ready },
        })
        return {
          capacity: room.capacity as 2 | 3 | 4,
          hostId: room.hostId,
          id: room.id,
          members: room.members.map((member) => ({
            ready: member.userId === updatedMember.userId ? updatedMember.ready : member.ready,
            seat: member.seat,
            userId: member.userId,
          })),
          status: 'waiting' as const,
          startsAt: null,
          tenderId: room.tenderId,
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
        if (room.members.some((member) => !member.ready)) {
          throw new RoomFailure('room_not_ready', 'Every player must be ready before starting')
        }

        const startsAt = new Date(Date.now() + 5_000)
        const startingRoom = await tx.tenderRoom.update({
          where: { id: room.id },
          data: { status: 'starting', startsAt },
          include: { members: { orderBy: { seat: 'asc' } } },
        })
        return {
          capacity: startingRoom.capacity as 2 | 3 | 4,
          hostId: startingRoom.hostId,
          id: startingRoom.id,
          members: startingRoom.members.map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
          status: 'starting' as const,
          startsAt: startsAt.toISOString(),
          tenderId: startingRoom.tenderId,
        }
      }, { isolationLevel: 'Serializable' })
    },
  }
}

async function releaseCompletedCurrentMatch(tx: Prisma.TransactionClient, userId: string) {
  const current = await tx.currentMatch.findUnique({
    where: { userId },
    include: { room: { include: { tender: { select: { phase: true } } } } },
  })
  if (current?.room.tender?.phase === 'complete') {
    await tx.currentMatch.delete({ where: { userId } })
  }
}

function isCurrentMatchUniqueConstraintError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'P2002' || error.code === 'P2034')
    && 'meta' in error
    && typeof error.meta === 'object'
    && error.meta !== null
    && 'modelName' in error.meta
    && error.meta.modelName === 'CurrentMatch'
}

function isRetryableTransactionError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2034'
}

function readTenderCompletionReason(state: Prisma.JsonValue | undefined) {
  if (
    typeof state === 'object'
    && state !== null
    && !Array.isArray(state)
    && state.completionReason === 'all_players_left'
  ) {
    return state.completionReason
  }
  return undefined
}
