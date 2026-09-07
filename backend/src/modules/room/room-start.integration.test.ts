import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { lockAccountLifecycleTransaction } from '../../security/account-lifecycle-lock'
import { createPersistentTenderModule } from '../tender'
import {
  cleanupPrismaRoomsForAccountDeletion,
  createRoomStartModule,
} from './index'
import { createPrismaRoomRepository } from './infrastructure/prisma-room-repository'
import { createPersistentTenderBotRunner } from '../tender'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const accountLifecycleSecret = 'room-account-lifecycle-integration-test-secret'
const clock = { now: () => new Date('2026-07-24T12:00:00.000Z') }

maybeDescribe('Room start integration', () => {
  if (!databaseUrl) return
  const prisma = createPrisma(databaseUrl)

  const cleanDatabase = async () => {
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.user.deleteMany()
  }

  beforeEach(cleanDatabase)
  afterEach(cleanDatabase)

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('starts a due Room once and creates its Tender with player name snapshots', async () => {
    const [host, guest] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Хост', login: 'room-host', passwordHash: 'hash' } }),
      prisma.user.create({ data: { displayName: 'Гость', login: 'room-guest', passwordHash: 'hash' } }),
    ])
    const room = await prisma.tenderRoom.create({
      data: {
        capacity: 2,
        hostId: host.id,
        members: { create: [{ seat: 1, userId: host.id }, { seat: 2, userId: guest.id }] },
        startsAt: new Date('2026-07-24T12:00:00.000Z'),
        status: 'starting',
      },
    })

    const roomStart = createRoomStartModule(prisma)

    const result = await roomStart.advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') })

    expect(result).toEqual({ started: [{ roomId: room.id, tenderId: expect.any(String) }] })
    const tenderId = result.started[0]?.tenderId
    await expect(createPersistentTenderModule(prisma).readTenderView({
      playerId: guest.id,
      tenderId: tenderId!,
    })).resolves.toMatchObject({
      players: [
        { displayName: 'Хост', playerId: host.id, tiePriority: 1 },
        { displayName: 'Гость', playerId: guest.id, tiePriority: 2 },
      ],
    })
    await expect(roomStart.advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') })).resolves.toEqual({ started: [] })

    await prisma.currentMatch.createMany({
      data: [
        { roomId: room.id, userId: host.id },
        { roomId: room.id, userId: guest.id },
      ],
    })
    await prisma.tender.update({
      where: { id: tenderId },
      data: { phase: 'complete' },
    })
    await expect(roomStart.releaseCompletedCurrentMatches()).resolves.toBe(2)
    expect(await prisma.currentMatch.count({ where: { roomId: room.id } })).toBe(0)
  })

  test('starts a due Room with one human and one persisted easy bot', async () => {
    const host = await prisma.user.create({
      data: { displayName: 'Хост', login: 'room-bot-start-host', passwordHash: 'hash' },
    })
    const botId = crypto.randomUUID()
    const room = await prisma.tenderRoom.create({
      data: {
        allowBots: true,
        bots: [{ difficulty: 'easy', id: botId, seat: 2 }],
        capacity: 2,
        hostId: host.id,
        members: { create: { ready: true, seat: 1, userId: host.id } },
        startsAt: new Date('2026-07-24T12:00:00.000Z'),
        status: 'starting',
      },
    })

    const result = await createRoomStartModule(prisma).advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') })
    const tenderId = result.started[0]?.tenderId
    await expect(createPersistentTenderBotRunner(prisma, accountLifecycleSecret).advance({ limit: 1 }))
      .resolves.toEqual({ acceptedCommands: 1, failedTenders: 0 })
    await expect(createPersistentTenderModule(prisma).readTenderView({
      playerId: host.id,
      tenderId: tenderId!,
    })).resolves.toMatchObject({
      players: [
        { displayName: 'Хост', playerId: host.id, tiePriority: 1 },
        { bot: { difficulty: 'easy', strategyVersion: 'bot-v1' }, playerId: botId, tiePriority: 2 },
      ],
    })
  })

  test('allows only the host to add and remove an easy bot from an opted-in waiting Room', async () => {
    const [host, guest] = await Promise.all([
      prisma.user.create({ data: { login: 'bot-room-host', passwordHash: 'hash' } }),
      prisma.user.create({ data: { login: 'bot-room-guest', passwordHash: 'hash' } }),
    ])
    const room = await prisma.tenderRoom.create({
      data: {
        allowBots: true,
        capacity: 4,
        hostId: host.id,
        members: { create: [{ ready: true, seat: 1, userId: host.id }, { ready: true, seat: 2, userId: guest.id }] },
        status: 'waiting',
      },
    })
    const repository = createPrismaRoomRepository(prisma, clock, accountLifecycleSecret)

    await expect(repository.addBot({ actorId: guest.id, difficulty: 'easy', roomId: room.id, seat: 4 }))
      .rejects.toMatchObject({ kind: 'room_not_found' })
    const withBot = await repository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 4 })
    expect(withBot).toMatchObject({
      bots: [{ difficulty: 'easy', id: expect.any(String), seat: 4 }],
      members: [{ ready: false, userId: host.id }, { ready: false, userId: guest.id }],
    })
    await expect(repository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 4 }))
      .rejects.toMatchObject({ kind: 'room_full' })
    const persistedWithBot = await prisma.tenderRoom.findUniqueOrThrow({ where: { id: room.id } })
    expect(persistedWithBot.bots).toEqual(withBot.bots ?? [])
    const botId = (persistedWithBot.bots as Array<{ id: string }>)[0]?.id
    expect(botId).toBeDefined()
    await expect(repository.removeBot({ actorId: guest.id, botId: botId!, roomId: room.id }))
      .rejects.toMatchObject({ kind: 'room_not_found' })
    const withoutBot = await repository.removeBot({ actorId: host.id, botId: botId!, roomId: room.id })
    expect(withoutBot).toMatchObject({ bots: [], members: [{ ready: false }, { ready: false }] })
  })

  test('serializes a human join and bot add so they cannot occupy the same final seat', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    try {
      const [host, guest] = await Promise.all([
        prisma.user.create({ data: { login: 'bot-race-host', passwordHash: 'hash' } }),
        prisma.user.create({ data: { login: 'bot-race-guest', passwordHash: 'hash' } }),
      ])
      const room = await prisma.tenderRoom.create({
        data: {
          allowBots: true,
          capacity: 2,
          hostId: host.id,
          members: { create: { seat: 1, userId: host.id } },
          status: 'waiting',
        },
      })
      await prisma.currentMatch.create({ data: { roomId: room.id, userId: host.id } })
      const hostRepository = createPrismaRoomRepository(prisma, clock, accountLifecycleSecret)
      const guestRepository = createPrismaRoomRepository(secondPrisma, clock, accountLifecycleSecret)

      const outcomes = await Promise.allSettled([
        hostRepository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 2 }),
        guestRepository.join({ actorId: guest.id, roomId: room.id }),
      ])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      const persisted = await prisma.tenderRoom.findUniqueOrThrow({
        where: { id: room.id },
        include: { members: { orderBy: { seat: 'asc' } } },
      })
      expect(persisted.members.length + (persisted.bots as Array<unknown>).length).toBe(2)
      expect(new Set([
        ...persisted.members.map((member) => member.seat),
        ...(persisted.bots as Array<{ seat: number }>).map((bot) => bot.seat),
      ])).toEqual(new Set([1, 2]))
    } finally {
      await secondPrisma.$disconnect()
    }
  })

  test('joins the remaining seat when a persisted bot occupies an earlier seat', async () => {
    const [host, guest] = await Promise.all([
      prisma.user.create({ data: { login: 'bot-seat-host', passwordHash: 'hash' } }),
      prisma.user.create({ data: { login: 'bot-seat-guest', passwordHash: 'hash' } }),
    ])
    const room = await prisma.tenderRoom.create({
      data: {
        allowBots: true,
        bots: [{ difficulty: 'easy', id: crypto.randomUUID(), seat: 2 }],
        capacity: 3,
        hostId: host.id,
        members: { create: { seat: 1, userId: host.id } },
        status: 'waiting',
      },
    })
    await prisma.currentMatch.create({ data: { roomId: room.id, userId: host.id } })

    await expect(createPrismaRoomRepository(prisma, clock, accountLifecycleSecret).join({
      actorId: guest.id,
      roomId: room.id,
    })).resolves.toMatchObject({
      members: [{ seat: 1, userId: host.id }, { seat: 3, userId: guest.id }],
    })
  })

  test('reopens a starting Room under the remaining player when its host account is deleted', async () => {
    const [host, guest] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Хост', login: 'deleted-starting-host', passwordHash: 'hash' } }),
      prisma.user.create({ data: { displayName: 'Гость', login: 'remaining-starting-guest', passwordHash: 'hash' } }),
    ])
    const room = await prisma.tenderRoom.create({
      data: {
        capacity: 2,
        hostId: host.id,
        members: {
          create: [
            { ready: true, seat: 1, userId: host.id },
            { ready: true, seat: 2, userId: guest.id },
          ],
        },
        startsAt: new Date('2026-07-24T12:00:00.000Z'),
        status: 'starting',
      },
    })
    await prisma.currentMatch.createMany({
      data: [
        { roomId: room.id, userId: host.id },
        { roomId: room.id, userId: guest.id },
      ],
    })

    await prisma.$transaction(
      (transaction) => cleanupPrismaRoomsForAccountDeletion(transaction, host.id),
      { isolationLevel: 'Serializable' },
    )

    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.id },
      include: {
        currentMatches: { orderBy: { userId: 'asc' } },
        members: { orderBy: { seat: 'asc' } },
      },
    })).toMatchObject({
      currentMatches: [{ userId: guest.id }],
      hostId: guest.id,
      members: [{ ready: false, seat: 2, userId: guest.id }],
      startsAt: null,
      status: 'waiting',
      tenderId: null,
    })
    await expect(createRoomStartModule(prisma).advanceDueRoomStarts({
      now: new Date('2026-07-24T12:00:05.000Z'),
    })).resolves.toEqual({ started: [] })
    expect(await prisma.tender.count()).toBe(0)
  })

  test('deletes a waiting Room when the deleted account is its only member', async () => {
    const host = await prisma.user.create({
      data: { displayName: 'Хост', login: 'deleted-only-room-host', passwordHash: 'hash' },
    })
    const room = await prisma.tenderRoom.create({
      data: {
        capacity: 2,
        hostId: host.id,
        members: { create: { seat: 1, userId: host.id } },
        status: 'waiting',
      },
    })
    await prisma.currentMatch.create({ data: { roomId: room.id, userId: host.id } })

    await prisma.$transaction(
      (transaction) => cleanupPrismaRoomsForAccountDeletion(transaction, host.id),
      { isolationLevel: 'Serializable' },
    )

    expect(await prisma.tenderRoom.findUnique({ where: { id: room.id } })).toBeNull()
    expect(await prisma.tenderRoomMember.count({ where: { userId: host.id } })).toBe(0)
    expect(await prisma.currentMatch.count({ where: { userId: host.id } })).toBe(0)
  })

  test('deletes a waiting Room with bots when its last human account is deleted', async () => {
    const host = await prisma.user.create({
      data: { login: 'deleted-only-bot-room-host', passwordHash: 'hash' },
    })
    const room = await prisma.tenderRoom.create({
      data: {
        allowBots: true,
        bots: [{ difficulty: 'easy', id: crypto.randomUUID(), seat: 2 }],
        capacity: 2,
        hostId: host.id,
        members: { create: { seat: 1, userId: host.id } },
        status: 'waiting',
      },
    })
    await prisma.currentMatch.create({ data: { roomId: room.id, userId: host.id } })

    await prisma.$transaction(
      (transaction) => cleanupPrismaRoomsForAccountDeletion(transaction, host.id),
      { isolationLevel: 'Serializable' },
    )

    expect(await prisma.tenderRoom.findUnique({ where: { id: room.id } })).toBeNull()
  })

  test('serializes Room creation behind account deletion and rejects the tombstone', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    const deletionMayCommit = deferred()
    const deletionHasLock = deferred()
    try {
      const account = await prisma.user.create({
        data: { login: 'deleted-room-creator', passwordHash: 'hash' },
      })
      const deletion = prisma.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, accountLifecycleSecret, account.id)
        deletionHasLock.resolve()
        await deletionMayCommit.promise
        await cleanupPrismaRoomsForAccountDeletion(transaction, account.id)
        await transaction.user.update({
          where: { id: account.id },
          data: { anonymizedAt: new Date('2026-07-24T12:00:00.000Z') },
        })
      }, { isolationLevel: 'Serializable' })
      await deletionHasLock.promise

      let creationSettled = false
      const creation = createPrismaRoomRepository(
        secondPrisma,
        clock,
        accountLifecycleSecret,
      ).create({ capacity: 2, hostId: account.id }).then(
        (createdRoom) => ({ createdRoom, kind: 'created' as const }),
        (error: unknown) => ({ error, kind: 'rejected' as const }),
      ).finally(() => {
        creationSettled = true
      })

      try {
        await waitForAdvisoryLockWait(prisma)
        expect(creationSettled).toBe(false)
      } finally {
        deletionMayCommit.resolve()
      }

      await deletion
      expect(await creation).toMatchObject({
        error: { kind: 'room_account_unavailable' },
        kind: 'rejected',
      })
      expect(await prisma.tenderRoom.count({ where: { hostId: account.id } })).toBe(0)
      expect(await prisma.tenderRoomMember.count({ where: { userId: account.id } })).toBe(0)
      expect(await prisma.currentMatch.count({ where: { userId: account.id } })).toBe(0)
    } finally {
      deletionMayCommit.resolve()
      await secondPrisma.$disconnect()
    }
  }, 15_000)

  test('serializes Room joining behind account deletion and rejects the tombstone', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    const deletionMayCommit = deferred()
    const deletionHasLock = deferred()
    try {
      const [host, joiningAccount] = await Promise.all([
        prisma.user.create({ data: { login: 'remaining-room-host', passwordHash: 'hash' } }),
        prisma.user.create({ data: { login: 'deleted-room-joiner', passwordHash: 'hash' } }),
      ])
      const room = await prisma.tenderRoom.create({
        data: {
          capacity: 2,
          hostId: host.id,
          members: { create: { seat: 1, userId: host.id } },
          status: 'waiting',
        },
      })
      await prisma.currentMatch.create({ data: { roomId: room.id, userId: host.id } })
      const deletion = prisma.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, accountLifecycleSecret, joiningAccount.id)
        deletionHasLock.resolve()
        await deletionMayCommit.promise
        await cleanupPrismaRoomsForAccountDeletion(transaction, joiningAccount.id)
        await transaction.user.update({
          where: { id: joiningAccount.id },
          data: { anonymizedAt: new Date('2026-07-24T12:00:00.000Z') },
        })
      }, { isolationLevel: 'Serializable' })
      await deletionHasLock.promise

      let joinSettled = false
      const joining = createPrismaRoomRepository(
        secondPrisma,
        clock,
        accountLifecycleSecret,
      ).join({ actorId: joiningAccount.id, roomId: room.id }).then(
        (joinedRoom) => ({ joinedRoom, kind: 'joined' as const }),
        (error: unknown) => ({ error, kind: 'rejected' as const }),
      ).finally(() => {
        joinSettled = true
      })

      try {
        await waitForAdvisoryLockWait(prisma)
        expect(joinSettled).toBe(false)
      } finally {
        deletionMayCommit.resolve()
      }

      await deletion
      expect(await joining).toMatchObject({
        error: { kind: 'room_account_unavailable' },
        kind: 'rejected',
      })
      expect(await prisma.tenderRoom.findUniqueOrThrow({
        where: { id: room.id },
        include: { members: true },
      })).toMatchObject({
        hostId: host.id,
        members: [{ userId: host.id }],
      })
      expect(await prisma.currentMatch.count({ where: { userId: joiningAccount.id } })).toBe(0)
    } finally {
      deletionMayCommit.resolve()
      await secondPrisma.$disconnect()
    }
  }, 15_000)

  test('retries a Room start after deletion commits and rejects the tombstoned host', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    const deletionMayCommit = deferred()
    const deletionHasLock = deferred()
    try {
      const [host, guest] = await Promise.all([
        prisma.user.create({ data: { login: 'deleted-room-start-host', passwordHash: 'hash' } }),
        prisma.user.create({ data: { login: 'remaining-room-start-guest', passwordHash: 'hash' } }),
      ])
      const room = await prisma.tenderRoom.create({
        data: {
          capacity: 2,
          hostId: host.id,
          members: {
            create: [
              { ready: true, seat: 1, userId: host.id },
              { ready: true, seat: 2, userId: guest.id },
            ],
          },
          status: 'waiting',
        },
      })
      const deletion = prisma.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, accountLifecycleSecret, host.id)
        deletionHasLock.resolve()
        await deletionMayCommit.promise
        await cleanupPrismaRoomsForAccountDeletion(transaction, host.id)
        await transaction.user.update({
          where: { id: host.id },
          data: { anonymizedAt: new Date('2026-07-24T12:00:00.000Z') },
        })
      }, { isolationLevel: 'Serializable' })
      await deletionHasLock.promise

      const starting = createPrismaRoomRepository(
        secondPrisma,
        clock,
        accountLifecycleSecret,
      ).start({ actorId: host.id, roomId: room.id })
      try {
        await waitForAdvisoryLockWait(prisma)
      } finally {
        deletionMayCommit.resolve()
      }

      await deletion
      await expect(starting).rejects.toMatchObject({ kind: 'room_account_unavailable' })
      expect(await prisma.tenderRoom.findUniqueOrThrow({
        where: { id: room.id },
        select: {
          hostId: true,
          members: { select: { ready: true, userId: true } },
          startsAt: true,
          status: true,
        },
      })).toEqual({
        hostId: guest.id,
        members: [{ ready: false, userId: guest.id }],
        startsAt: null,
        status: 'waiting',
      })
    } finally {
      deletionMayCommit.resolve()
      await secondPrisma.$disconnect()
    }
  }, 15_000)

  test('does not create a scheduled Tender after account deletion wins a member lifecycle lock', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    const deletionMayCommit = deferred()
    const deletionHasLock = deferred()
    try {
      const [host, deletedMember] = await Promise.all([
        prisma.user.create({ data: { login: 'scheduled-room-host', passwordHash: 'hash' } }),
        prisma.user.create({ data: { login: 'scheduled-room-deleted-member', passwordHash: 'hash' } }),
      ])
      const room = await prisma.tenderRoom.create({
        data: {
          capacity: 2,
          hostId: host.id,
          members: {
            create: [
              { ready: true, seat: 1, userId: host.id },
              { ready: true, seat: 2, userId: deletedMember.id },
            ],
          },
          startsAt: new Date('2026-07-24T12:00:00.000Z'),
          status: 'starting',
        },
      })
      const deletion = prisma.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(
          transaction,
          accountLifecycleSecret,
          deletedMember.id,
        )
        deletionHasLock.resolve()
        await deletionMayCommit.promise
        await cleanupPrismaRoomsForAccountDeletion(transaction, deletedMember.id)
        await transaction.user.update({
          where: { id: deletedMember.id },
          data: { anonymizedAt: new Date('2026-07-24T12:00:01.000Z') },
        })
      }, { isolationLevel: 'Serializable' })
      await deletionHasLock.promise

      const starting = createRoomStartModule(
        secondPrisma,
        accountLifecycleSecret,
      ).advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') })
      try {
        await waitForAdvisoryLockWait(prisma)
      } finally {
        deletionMayCommit.resolve()
      }

      await deletion
      await expect(starting).resolves.toEqual({ started: [] })
      expect(await prisma.tender.count()).toBe(0)
      expect(await prisma.tenderRoom.findUniqueOrThrow({
        where: { id: room.id },
        select: { startsAt: true, status: true },
      })).toEqual({ startsAt: null, status: 'waiting' })
    } finally {
      deletionMayCommit.resolve()
      await secondPrisma.$disconnect()
    }
  }, 15_000)

  test('creates one Tender when separate PostgreSQL pools race the same due Room', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    try {
      const [host, guest] = await Promise.all([
        prisma.user.create({ data: { displayName: 'Хост', login: 'parallel-room-host', passwordHash: 'hash' } }),
        prisma.user.create({ data: { displayName: 'Гость', login: 'parallel-room-guest', passwordHash: 'hash' } }),
      ])
      const room = await prisma.tenderRoom.create({
        data: {
          capacity: 2,
          hostId: host.id,
          members: { create: [{ seat: 1, userId: host.id }, { seat: 2, userId: guest.id }] },
          startsAt: new Date('2026-07-24T12:00:00.000Z'),
          status: 'starting',
        },
      })
      const firstWorker = createRoomStartModule(prisma)
      const secondWorker = createRoomStartModule(secondPrisma)

      const results = await Promise.all([
        firstWorker.advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') }),
        secondWorker.advanceDueRoomStarts({ now: new Date('2026-07-24T12:00:05.000Z') }),
      ])

      const started = results.flatMap((result) => result.started)
      expect(started).toEqual([{ roomId: room.id, tenderId: expect.any(String) }])
      expect(await prisma.tenderRoom.findUniqueOrThrow({
        where: { id: room.id },
        select: { startsAt: true, status: true, tenderId: true },
      })).toEqual({
        startsAt: null,
        status: 'started',
        tenderId: started[0]?.tenderId,
      })
      expect(await prisma.tender.count()).toBe(1)
    } finally {
      await secondPrisma.$disconnect()
    }
  }, 15_000)

  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise
    })
    return { promise, resolve }
  }

  async function waitForAdvisoryLockWait(db: ReturnType<typeof createPrisma>) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await db.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*)::bigint AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event = 'advisory'
      `
      if ((state?.waiting ?? 0n) > 0n) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for the Room operation to block on the account lifecycle lock')
  }
})
