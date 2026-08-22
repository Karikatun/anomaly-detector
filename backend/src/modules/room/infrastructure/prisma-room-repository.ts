import type { DbClient } from '../../../db'
import { randomBytes } from 'node:crypto'
import type { Prisma } from '../../../generated/prisma/client'
import type { Clock, RoomRecord, RoomRepository } from '../application/ports'
import { RoomFailure } from '../domain/errors'

const JOIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const roomMembersInclude = { members: { orderBy: { seat: 'asc' as const } } }

type RoomWithMembers = Prisma.TenderRoomGetPayload<{ include: typeof roomMembersInclude }>

export function toRoomRecord(
  room: RoomWithMembers,
  overrides: Partial<Pick<RoomRecord, 'members' | 'startsAt' | 'status'>> = {},
): RoomRecord {
  return {
    capacity: room.capacity as 2 | 3 | 4,
    hostId: room.hostId,
    id: room.id,
    joinCode: room.joinCode,
    members: room.members.map((member) => ({
      ready: member.ready,
      seat: member.seat,
      userId: member.userId,
    })),
    status: room.status as RoomRecord['status'],
    startsAt: room.startsAt?.toISOString() ?? null,
    tenderId: room.tenderId,
    ...overrides,
  }
}

export function createPrismaRoomRepository(db: DbClient, clock: Clock = { now: () => new Date() }): RoomRepository {
  const repository: RoomRepository = {
    async cancelStart(input) {
      return db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findFirst({
          where: {
            hostId: input.actorId,
            id: input.roomId,
          },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'starting') throw new RoomFailure('room_not_joinable', 'Room is not starting')

        const waitingRoom = await tx.tenderRoom.update({
          where: { id: room.id },
          data: { status: 'waiting', startsAt: null },
          include: roomMembersInclude,
        })
        return toRoomRecord(waitingRoom)
      }, { isolationLevel: 'Serializable' })
    },
    async listStartedForMember(userId) {
      const rooms = await db.tenderRoom.findMany({
        where: { members: { some: { userId } }, status: 'started' },
        include: roomMembersInclude,
        orderBy: { updatedAt: 'desc' },
      })
      return rooms.map((room) => toRoomRecord(room))
    },
    async readCurrentForMember(userId) {
      const current = await db.currentMatch.findUnique({
        where: { userId },
        include: {
          room: {
            include: roomMembersInclude,
          },
        },
      })
      if (!current) return null
      return toRoomRecord(current.room)
    },
    async releaseCurrentForMember({ roomId, userId }) {
      await db.currentMatch.deleteMany({ where: { roomId, userId } })
    },
    async readForMember(input) {
      const room = await db.tenderRoom.findFirst({
        where: {
          id: input.roomId,
          members: { some: { userId: input.actorId } },
        },
        include: roomMembersInclude,
      })
      if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
      return toRoomRecord(room)
    },
    async create(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            if (await tx.currentMatch.findUnique({ where: { userId: input.hostId } })) {
              throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
            }
            const room = await tx.tenderRoom.create({
              data: {
                capacity: input.capacity,
                hostId: input.hostId,
                joinCode: generateRoomJoinCode(),
                status: 'waiting',
                members: {
                  create: { seat: 1, userId: input.hostId },
                },
              },
              include: roomMembersInclude,
            })
            await tx.currentMatch.create({
              data: { roomId: room.id, userId: input.hostId },
            })
            return toRoomRecord(room)
          }, { isolationLevel: 'Serializable' })
        } catch (error) {
          if ((isRetryableTransactionError(error) || isJoinCodeUniqueConstraintError(error)) && attempt < 2) continue
          if (isCurrentMatchUniqueConstraintError(error)) {
            throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
          }
          throw error
        }
      }
      throw new Error('Unreachable room creation transaction retry state')
    },

    async join(input) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const currentMatch = await tx.currentMatch.findUnique({
              where: { userId: input.actorId },
              select: { roomId: true },
            })
            if (currentMatch && currentMatch.roomId !== input.roomId) {
              throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
            }
            const room = await tx.tenderRoom.findUnique({
              where: { id: input.roomId },
              include: roomMembersInclude,
            })
            if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
            if (room.members.some((member) => member.userId === input.actorId)) {
              if (!currentMatch) {
                await tx.currentMatch.create({
                  data: { roomId: room.id, userId: input.actorId },
                })
              }
              // Already joined — return current room state (idempotent poll)
              return toRoomRecord(room)
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
            return toRoomRecord(room, {
              members: [
                ...room.members.map((member) => ({ ...member, ready: false })),
                { ready: false, seat, userId: input.actorId },
              ]
                .sort((left, right) => left.seat - right.seat)
                .map((member) => ({ ready: member.ready, seat: member.seat, userId: member.userId })),
            })
          }, { isolationLevel: 'Serializable' })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) {
            await waitForTransactionRetry(attempt)
            continue
          }
          if (isCurrentMatchUniqueConstraintError(error)) {
            throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
          }
          throw error
        }
      }
      throw new Error('Unreachable room join transaction retry state')
    },

    async joinByCode(input) {
      const room = await db.tenderRoom.findUnique({
        where: { joinCode: input.code },
        select: { id: true },
      })
      if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
      return repository.join({ actorId: input.actorId, roomId: room.id })
    },

    async leave(input) {
      await db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findFirst({
          where: {
            id: input.roomId,
            members: { some: { userId: input.actorId } },
          },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')

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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db.$transaction(async (tx) => {
            const room = await tx.tenderRoom.findFirst({
              where: {
                id: input.roomId,
                members: { some: { userId: input.actorId } },
              },
              include: roomMembersInclude,
            })
            if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
            if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')

            const updatedMember = await tx.tenderRoomMember.update({
              where: { roomId_userId: { roomId: room.id, userId: input.actorId } },
              data: { ready: input.ready },
            })
            return toRoomRecord(room, {
              members: room.members.map((member) => ({
                ready: member.userId === updatedMember.userId ? updatedMember.ready : member.ready,
                seat: member.seat,
                userId: member.userId,
              })),
            })
          }, { isolationLevel: 'Serializable' })
        } catch (error) {
          if (isRetryableTransactionError(error) && attempt < 2) {
            await waitForTransactionRetry(attempt)
            continue
          }
          throw error
        }
      }
      throw new Error('Unreachable room readiness transaction retry state')
    },

    async start(input) {
      return db.$transaction(async (tx) => {
        const room = await tx.tenderRoom.findFirst({
          where: {
            hostId: input.actorId,
            id: input.roomId,
          },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room has already started')
        if (room.members.length !== room.capacity) throw new RoomFailure('room_full', 'Room needs every seat filled before starting')
        if (room.members.some((member) => !member.ready)) {
          throw new RoomFailure('room_not_ready', 'Every player must be ready before starting')
        }

        const startsAt = new Date(clock.now().getTime() + 5_000)
        const startingRoom = await tx.tenderRoom.update({
          where: { id: room.id },
          data: { status: 'starting', startsAt },
          include: roomMembersInclude,
        })
        return toRoomRecord(startingRoom)
      }, { isolationLevel: 'Serializable' })
    },
  }
  return repository
}

function generateRoomJoinCode() {
  return Array.from(randomBytes(10), (byte) => JOIN_CODE_ALPHABET[byte & 31]).join('')
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

function isJoinCodeUniqueConstraintError(error: unknown) {
  if (
    typeof error !== 'object'
    || error === null
    || !('code' in error)
    || error.code !== 'P2002'
    || !('meta' in error)
    || typeof error.meta !== 'object'
    || error.meta === null
  ) return false

  const target = 'target' in error.meta ? error.meta.target : undefined
  return Array.isArray(target)
    ? target.includes('join_code')
    : String(target).includes('join_code')
}

function isRetryableTransactionError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 'P2034') return true

  const cause = 'cause' in error ? error.cause : undefined
  if (isTransactionWriteConflict(cause)) return true

  const meta = 'meta' in error ? error.meta : undefined
  if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) return false
  const driverAdapterError = meta.driverAdapterError
  return typeof driverAdapterError === 'object'
    && driverAdapterError !== null
    && 'cause' in driverAdapterError
    && isTransactionWriteConflict(driverAdapterError.cause)
}

function isTransactionWriteConflict(value: unknown) {
  return typeof value === 'object'
    && value !== null
    && 'kind' in value
    && value.kind === 'TransactionWriteConflict'
}

function waitForTransactionRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)))
}
