import { isRetryableDatabaseTransactionConflict, type DbClient } from '../../../db'
import { randomBytes } from 'node:crypto'
import { roomBotSchema, type RoomBot } from '@anomaly-detector/contracts'
import type { Prisma } from '../../../generated/prisma/client'
import { lockActiveAccountLifecycleTransaction } from '../../../security/account-lifecycle-lock'
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
    allowBots: room.allowBots ?? false,
    bots: roomBotSchema.array().parse(room.bots ?? []),
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

export function createPrismaRoomRepository(
  db: DbClient,
  clock: Clock,
  accountLifecycleSecret: string,
): RoomRepository {
  const repository: RoomRepository = {
    async cancelStart(input) {
      return runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
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
      })
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
            await requireActiveRoomActor(tx, accountLifecycleSecret, input.hostId)
            if (await tx.currentMatch.findUnique({ where: { userId: input.hostId } })) {
              throw new RoomFailure('room_current_match_exists', 'Player already has an unfinished match')
            }
            const room = await tx.tenderRoom.create({
              data: {
                allowBots: input.allowBots ?? false,
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
          if (
            (isRetryableDatabaseTransactionConflict(error) || isJoinCodeUniqueConstraintError(error))
            && attempt < 2
          ) {
            await waitForTransactionRetry(attempt)
            continue
          }
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
            await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
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
            if (room.members.length + roomBotSchema.array().parse(room.bots ?? []).length >= room.capacity) {
              throw new RoomFailure('room_full', 'Room is already full')
            }

            const occupiedSeats = new Set([
              ...room.members.map((member) => member.seat),
              ...roomBotSchema.array().parse(room.bots ?? []).map((bot) => bot.seat),
            ])
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
          if (isRetryableDatabaseTransactionConflict(error) && attempt < 2) {
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

    async addBot(input) {
      return runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
        const room = await tx.tenderRoom.findFirst({
          where: { hostId: input.actorId, id: input.roomId },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        if (!room.allowBots) throw new RoomFailure('room_bots_not_allowed', 'Room does not allow bots')
        const bots = roomBotSchema.array().parse(room.bots ?? [])
        if (room.members.length + bots.length >= room.capacity) {
          throw new RoomFailure('room_full', 'Room is already full')
        }
        const occupiedSeats = new Set([...room.members, ...bots].map((participant) => participant.seat))
        if (input.seat > room.capacity || occupiedSeats.has(input.seat)) {
          throw new RoomFailure('room_full', 'Requested Room seat is unavailable')
        }
        const nextBots: RoomBot[] = [...bots, {
          difficulty: input.difficulty,
          id: crypto.randomUUID(),
          seat: input.seat,
        }]
        await tx.tenderRoomMember.updateMany({
          where: { roomId: room.id },
          data: { ready: false },
        })
        return toRoomRecord(await tx.tenderRoom.update({
          where: { id: room.id },
          data: { bots: nextBots },
          include: roomMembersInclude,
        }))
      })
    },

    async removeBot(input) {
      return runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
        const room = await tx.tenderRoom.findFirst({
          where: { hostId: input.actorId, id: input.roomId },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        const bots = roomBotSchema.array().parse(room.bots ?? [])
        const nextBots = bots.filter((bot) => bot.id !== input.botId)
        if (nextBots.length === bots.length) throw new RoomFailure('room_bot_not_found', 'Bot does not exist')
        await tx.tenderRoomMember.updateMany({
          where: { roomId: room.id },
          data: { ready: false },
        })
        return toRoomRecord(await tx.tenderRoom.update({
          where: { id: room.id },
          data: { bots: nextBots },
          include: roomMembersInclude,
        }))
      })
    },

    async updateBotDifficulty(input) {
      return runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
        const room = await tx.tenderRoom.findFirst({
          where: { hostId: input.actorId, id: input.roomId },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room is no longer waiting for players')
        const bots = roomBotSchema.array().parse(room.bots ?? [])
        const bot = bots.find((candidate) => candidate.id === input.botId)
        if (!bot) throw new RoomFailure('room_bot_not_found', 'Bot does not exist')
        if (bot.difficulty === input.difficulty) return toRoomRecord(room)
        const nextBots = bots.map((candidate) => candidate.id === input.botId
          ? { ...candidate, difficulty: input.difficulty }
          : candidate)
        await tx.tenderRoomMember.updateMany({
          where: { roomId: room.id },
          data: { ready: false },
        })
        return toRoomRecord(await tx.tenderRoom.update({
          where: { id: room.id },
          data: { bots: nextBots },
          include: roomMembersInclude,
        }))
      })
    },

    async leave(input) {
      await runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
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
      })
    },

    async setReady(input) {
      return runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
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
      })
    },

    async start(input) {
      return runRetryableRoomTransaction(db, async (tx) => {
        await requireActiveRoomActor(tx, accountLifecycleSecret, input.actorId)
        const room = await tx.tenderRoom.findFirst({
          where: {
            hostId: input.actorId,
            id: input.roomId,
          },
          include: roomMembersInclude,
        })
        if (!room) throw new RoomFailure('room_not_found', 'Room does not exist')
        if (room.status !== 'waiting') throw new RoomFailure('room_not_joinable', 'Room has already started')
        if (room.members.length + roomBotSchema.array().parse(room.bots ?? []).length !== room.capacity) {
          throw new RoomFailure('room_full', 'Room needs every seat filled before starting')
        }
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
      })
    },
  }
  return repository
}

async function runRetryableRoomTransaction<T>(
  db: DbClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: 'Serializable' })
    } catch (error) {
      if (!isRetryableDatabaseTransactionConflict(error) || attempt >= 2) throw error
      await waitForTransactionRetry(attempt)
    }
  }
  throw new Error('Unreachable Room transaction retry state')
}

async function requireActiveRoomActor(
  transaction: Prisma.TransactionClient,
  accountLifecycleSecret: string,
  userId: string,
) {
  if (!await lockActiveAccountLifecycleTransaction(
    transaction,
    accountLifecycleSecret,
    userId,
  )) {
    throw new RoomFailure('room_account_unavailable', 'Authentication is no longer active')
  }
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

function waitForTransactionRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 10 * (2 ** attempt)))
}
