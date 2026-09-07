import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createPersistentTenderModule } from '../tender'
import { createRoomStartModule } from './index'
import { createPrismaRoomRepository } from './infrastructure/prisma-room-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const accountLifecycleSecret = 'room-composition-integration-test-secret'
const clock = { now: () => new Date('2026-09-07T12:00:00.000Z') }
const startAt = new Date('2026-09-07T12:00:05.000Z')

type BotDifficulty = 'easy' | 'hard'
type ExpectedParticipant =
  | { id: string; kind: 'human'; seat: number }
  | { difficulty: BotDifficulty; id: string; kind: 'bot'; seat: number }
type Composition = {
  botSeats: number[]
  capacity: 2 | 3 | 4
  difficulties: BotDifficulty[]
  humanSeats: number[]
  name: string
}

const compositions: Composition[] = [
  { name: 'one human and one easy bot', capacity: 2, humanSeats: [1], botSeats: [2], difficulties: ['easy'] },
  { name: 'one human and two mixed bots', capacity: 3, humanSeats: [1], botSeats: [2, 3], difficulties: ['easy', 'hard'] },
  { name: 'two humans and one hard bot', capacity: 3, humanSeats: [1, 2], botSeats: [3], difficulties: ['hard'] },
  { name: 'one human and three mixed bots', capacity: 4, humanSeats: [1], botSeats: [2, 3, 4], difficulties: ['easy', 'hard', 'easy'] },
  { name: 'two humans and two mixed alternating bots', capacity: 4, humanSeats: [1, 3], botSeats: [2, 4], difficulties: ['hard', 'easy'] },
  { name: 'three humans and one hard bot', capacity: 4, humanSeats: [1, 2, 3], botSeats: [4], difficulties: ['hard'] },
]

maybeDescribe('Room mixed composition PostgreSQL matrix', () => {
  if (!databaseUrl) return
  const prisma = createPrisma(databaseUrl)

  const cleanDatabase = async () => {
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.user.deleteMany()
  }
  beforeEach(cleanDatabase)
  afterEach(cleanDatabase)
  afterAll(async () => { await prisma.$disconnect() })

  const createUser = (login: string, displayName = login) => prisma.user.create({
    data: { displayName, login, passwordHash: 'hash' },
  })
  test.each(compositions)('starts exact seat-ordered Tender roster for $name', async (composition) => {
    const host = await createUser(`matrix-${composition.capacity}-${composition.humanSeats.length}-host`, 'Хост')
    const guests = await Promise.all(composition.humanSeats.slice(1).map((_, index) =>
      createUser(`matrix-${composition.capacity}-${composition.humanSeats.length}-guest-${index + 1}`, `Гость ${index + 1}`)))
    const repository = createPrismaRoomRepository(prisma, clock, accountLifecycleSecret)
    const room = await repository.create({ allowBots: true, capacity: composition.capacity, hostId: host.id })
    const expected: ExpectedParticipant[] = [{ id: host.id, kind: 'human', seat: 1 }]

    for (let seat = 2; seat <= composition.capacity; seat += 1) {
      const botIndex = composition.botSeats.indexOf(seat)
      if (botIndex >= 0) {
        const updated = await repository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat })
        const bot = updated.bots?.find((candidate) => candidate.seat === seat)
        if (!bot) throw new Error('Expected newly persisted bot')
        if (composition.difficulties[botIndex] === 'hard') {
          await repository.updateBotDifficulty({ actorId: host.id, botId: bot.id, difficulty: 'hard', roomId: room.id })
        }
        expected.push({ difficulty: composition.difficulties[botIndex]!, id: bot.id, kind: 'bot', seat })
      } else {
        const guest = guests.shift()
        if (!guest) throw new Error('Missing matrix guest')
        const joined = await repository.join({ actorId: guest.id, roomId: room.id })
        expect(joined.members.find((member) => member.userId === guest.id)?.seat).toBe(seat)
        expected.push({ id: guest.id, kind: 'human' as const, seat })
      }
    }

    for (const member of expected.filter((participant) => participant.kind === 'human')) {
      await repository.setReady({ actorId: member.id, ready: true, roomId: room.id })
    }
    await expect(repository.start({ actorId: host.id, roomId: room.id })).resolves.toMatchObject({ status: 'starting' })
    const started = await createRoomStartModule(prisma, accountLifecycleSecret).advanceDueRoomStarts({ now: startAt })
    const tenderId = started.started[0]?.tenderId
    expect(started).toEqual({ started: [{ roomId: room.id, tenderId: expect.any(String) }] })

    const view = await createPersistentTenderModule(prisma, accountLifecycleSecret).readTenderView({
      playerId: host.id,
      tenderId: tenderId!,
    })
    expect(view.players.map((player) => ({
      bot: player.bot,
      playerId: player.playerId,
      tiePriority: player.tiePriority,
    }))).toEqual(expected.map((participant) => ({
      bot: participant.kind === 'bot' ? {
          difficulty: participant.difficulty,
          strategyVersion: 'bot-v2' as const,
        } : undefined,
      playerId: participant.id,
      tiePriority: participant.seat,
    })))
  })

  test('removing a requested later-seat bot frees only that seat for a joining human', async () => {
    const [host, guest] = await Promise.all([createUser('later-seat-host'), createUser('later-seat-guest')])
    const repository = createPrismaRoomRepository(prisma, clock, accountLifecycleSecret)
    const room = await repository.create({ allowBots: true, capacity: 4, hostId: host.id })
    const withLaterBot = await repository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 4 })
    const bot = withLaterBot.bots?.[0]
    if (!bot) throw new Error('Expected bot in later seat')
    await repository.removeBot({ actorId: host.id, botId: bot.id, roomId: room.id })
    const joined = await repository.join({ actorId: guest.id, roomId: room.id })
    expect(joined.members.find((member) => member.userId === guest.id)?.seat).toBe(2)
    await expect(repository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 4 }))
      .resolves.toMatchObject({ bots: [{ seat: 4 }] })
  })

  test('serializes remove, join, and start without exceeding capacity or diverging the started Tender roster', async () => {
    const secondPrisma = createPrisma(databaseUrl)
    try {
      const [host, firstGuest, waitingGuest] = await Promise.all([
        createUser('race-remove-host'), createUser('race-remove-first-guest'), createUser('race-remove-waiting-guest'),
      ])
      const firstRepository = createPrismaRoomRepository(prisma, clock, accountLifecycleSecret)
      const secondRepository = createPrismaRoomRepository(secondPrisma, clock, accountLifecycleSecret)
      const room = await firstRepository.create({ allowBots: true, capacity: 4, hostId: host.id })
      const firstBot = await firstRepository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 2 })
      const botId = firstBot.bots?.[0]?.id
      if (!botId) throw new Error('Expected first bot')
      await firstRepository.join({ actorId: firstGuest.id, roomId: room.id })
      await firstRepository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 4 })
      await firstRepository.setReady({ actorId: host.id, ready: true, roomId: room.id })
      await firstRepository.setReady({ actorId: firstGuest.id, ready: true, roomId: room.id })

      await Promise.allSettled([
        firstRepository.removeBot({ actorId: host.id, botId, roomId: room.id }),
        secondRepository.join({ actorId: waitingGuest.id, roomId: room.id }),
        secondRepository.start({ actorId: host.id, roomId: room.id }),
      ])
      const persisted = await prisma.tenderRoom.findUniqueOrThrow({
        where: { id: room.id },
        include: { members: { orderBy: { seat: 'asc' } } },
      })
      const bots = persisted.bots as Array<{ id: string; seat: number }>
      expect(persisted.members.length + bots.length).toBeLessThanOrEqual(4)
      expect(new Set([...persisted.members.map((member) => member.seat), ...bots.map((bot) => bot.seat)]).size)
        .toBe(persisted.members.length + bots.length)

      if (persisted.status === 'starting') {
        const started = await createRoomStartModule(prisma, accountLifecycleSecret).advanceDueRoomStarts({ now: startAt })
        const tenderId = started.started.find((entry) => entry.roomId === room.id)?.tenderId
        const view = await createPersistentTenderModule(prisma, accountLifecycleSecret).readTenderView({ playerId: host.id, tenderId: tenderId! })
        expect(view.players.map((player) => player.playerId).sort()).toEqual([
          ...persisted.members.map((member) => member.userId), ...bots.map((bot) => bot.id),
        ].sort())
      }
    } finally {
      await secondPrisma.$disconnect()
    }
  })

  test('host departure promotes a human member and never a bot; removing the last human removes the lobby', async () => {
    const [host, guest] = await Promise.all([createUser('host-leave-host'), createUser('host-leave-guest')])
    const repository = createPrismaRoomRepository(prisma, clock, accountLifecycleSecret)
    const room = await repository.create({ allowBots: true, capacity: 3, hostId: host.id })
    await repository.addBot({ actorId: host.id, difficulty: 'easy', roomId: room.id, seat: 2 })
    await repository.join({ actorId: guest.id, roomId: room.id })
    await repository.leave({ actorId: host.id, roomId: room.id })
    expect(await prisma.tenderRoom.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ hostId: guest.id })

    await repository.leave({ actorId: guest.id, roomId: room.id })
    expect(await prisma.tenderRoom.findUnique({ where: { id: room.id } })).toBeNull()
    const solo = await repository.create({ allowBots: true, capacity: 2, hostId: guest.id })
    await repository.addBot({ actorId: guest.id, difficulty: 'easy', roomId: solo.id, seat: 2 })
    await repository.leave({ actorId: guest.id, roomId: solo.id })
    expect(await prisma.tenderRoom.findUnique({ where: { id: solo.id } })).toBeNull()
  })
})
