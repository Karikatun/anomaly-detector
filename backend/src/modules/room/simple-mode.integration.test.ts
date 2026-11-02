import { afterAll, expect, test } from 'bun:test'
import { createPrisma } from '../../db'
import { createPersistentTenderModule, createPersistentCompletedTenderSummaryReader, createPersistentTenderBotRunner } from '../tender'
import { createRoomStartModule } from './index'
import { createPrismaRoomRepository } from './infrastructure/prisma-room-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const db = databaseUrl ? createPrisma(databaseUrl) : undefined
afterAll(async () => { await db?.$disconnect() })

for (const count of [2, 3, 4]) test.skipIf(!db)(`persists a complete simple room journey for ${count} simulated authenticated accounts`, async () => {
  const players = await Promise.all(Array.from({ length: count }, () => db!.user.create({ data: { login: `simple-${crypto.randomUUID()}`, passwordHash: 'test-hash' } })))
  const now = new Date()
  const repository = createPrismaRoomRepository(db!, { now: () => now }, 'simple-room-test-account-lock-secret')
  let roomId: string | undefined
  let tenderId: string | undefined
  try {
    const created = await repository.create({ mode: 'simple', capacity: count as 2 | 3 | 4, hostId: players[0]!.id })
    roomId = created.id
    expect(created.mode).toBe('simple')
    for (const p of players.slice(1)) await repository.join({ actorId: p.id, roomId })
    for (const p of players) await repository.setReady({ actorId: p.id, ready: true, roomId })
    const scheduled = await repository.start({ actorId: players[0]!.id, roomId })
    expect(scheduled.mode).toBe('simple')
    await createRoomStartModule(db!).advanceDueRoomStarts({ now: new Date(now.getTime() + 10_000) })
    tenderId = (await repository.readForMember({ actorId: players[0]!.id, roomId })).tenderId!
    let tender = createPersistentTenderModule(db!)
    let sequence = 0
    const command = (actorId: string, payload: object) => tender.execute({ actorId, commandId: `cmd-${++sequence}`, tenderId, ...payload } as never)
    const view = (playerId = players[0]!.id) => tender.readTenderView({ tenderId: tenderId!, playerId })
    for (let round = 1; round <= 3; round++) {
      expect((await view()).game?.mode).toBe('simple')
      expect((await view()).round).toBe(round)
      for (const p of players) await command(p.id, { type: 'request-access-slot', slot: 3 })
      for (const p of players) await command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } })
      tender = createPersistentTenderModule(db!)
      expect((await view()).publicFinalContract).toBeUndefined()
    }
    for (const p of players) await command(p.id, { type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'phase', polarity: 'positive' } } } })
    tender = createPersistentTenderModule(db!)
    const completed = await view()
    expect(completed.phase).toBe('complete')
    expect(completed.audit?.rounds).toHaveLength(3)
    expect(completed.audit?.game?.mode).toBe('simple')
    expect(completed.winnerPlayerIds).toHaveLength(1)
    expect(completed.audit?.finalSubmissionOrderByPlayer?.[players[0]!.id]).toBeLessThan(completed.audit!.finalSubmissionOrderByPlayer![players[1]!.id]!)
    expect((await repository.listStartedForMember(players[0]!.id))[0]?.mode).toBe('simple')
    expect((await createPersistentCompletedTenderSummaryReader(db!).listCompletedMatches(players[0]!.id))[0]?.mode).toBe('simple')
    await expect(view(crypto.randomUUID())).rejects.toMatchObject({ kind: 'player_not_in_tender' })
  } finally {
    if (roomId) await db!.tenderRoom.delete({ where: { id: roomId } })
    if (tenderId) await db!.tender.delete({ where: { id: tenderId } })
    await db!.user.deleteMany({ where: { id: { in: players.map((p) => p.id) } } })
  }
})

const botCompositions = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [3, 1]] as const
for (const [humanCount, botCount] of botCompositions) for (const difficulty of ['easy', 'hard'] as const) {
  test.skipIf(!db)(`simple room with ${humanCount} humans and ${botCount} ${difficulty} bots completes through the server worker and restart`, async () => {
    const humans = await Promise.all(Array.from({ length: humanCount }, () => db!.user.create({ data: {
      login: `simple-bots-${crypto.randomUUID()}`, passwordHash: 'test-hash',
    } })))
    const now = new Date()
    const secret = 'simple-room-test-account-lock-secret'
    const repository = createPrismaRoomRepository(db!, { now: () => now }, secret)
    let roomId: string | undefined, tenderId: string | undefined
    try {
      const room = await repository.create({ mode: 'simple', allowBots: true, capacity: (humanCount + botCount) as 2 | 3 | 4, hostId: humans[0]!.id })
      roomId = room.id
      for (const human of humans.slice(1)) await repository.join({ actorId: human.id, roomId })
      for (let index = 0; index < botCount; index++) {
        const updated = await repository.addBot({ actorId: humans[0]!.id, roomId, seat: humanCount + index + 1, difficulty: 'easy' })
        const bot = updated.bots!.find((item) => item.seat === humanCount + index + 1)!
        if (difficulty === 'hard') await repository.updateBotDifficulty({ actorId: humans[0]!.id, roomId, botId: bot.id, difficulty })
      }
      for (const human of humans) await repository.setReady({ actorId: human.id, ready: true, roomId })
      await repository.start({ actorId: humans[0]!.id, roomId })
      await createRoomStartModule(db!, secret).advanceDueRoomStarts({ now: new Date(now.getTime() + 10_000) })
      tenderId = (await repository.readForMember({ actorId: humans[0]!.id, roomId })).tenderId!
      for (let step = 0; step < 180; step++) {
        // Rebuild both service and worker from PostgreSQL; no process-local decisions carry across passes.
        const tender = createPersistentTenderModule(db!, secret)
        const view = await tender.readTenderView({ playerId: humans[0]!.id, tenderId })
        if (view.phase === 'complete') {
          expect(view.round).toBe(3)
          expect(view.audit?.rounds).toHaveLength(3)
          expect(view.players.filter((item) => item.bot).every((item) => item.bot!.strategyVersion === 'bot-simple-v1')).toBe(true)
          expect(Object.values(view.audit!.finalScientificModelsByPlayer).every((model) => model.submitted)).toBe(true)
          expect((await repository.listStartedForMember(humans[0]!.id)).some((item) => item.id === roomId && item.mode === 'simple')).toBe(true)
          expect(await createPersistentCompletedTenderSummaryReader(db!).listCompletedMatches(humans[0]!.id)).toEqual([])
          await expect(tender.readTenderView({ playerId: crypto.randomUUID(), tenderId })).rejects.toMatchObject({ kind: 'player_not_in_tender' })
          return
        }
        const botPass = await createPersistentTenderBotRunner(db!, secret).advance({ limit: 10 })
        expect(botPass.failedTenders).toBe(0)
        let humanAccepted = false
        for (const human of humans) {
          const own = await tender.readTenderView({ playerId: human.id, tenderId })
          const self = own.players.find((item) => item.playerId === human.id)!
          const base = { actorId: human.id, commandId: `human-${step}-${human.id}`, tenderId }
          const command = own.phase === 'access-slot-selection' && self.requestedAccessSlot === undefined
            ? { ...base, type: 'request-access-slot' as const, slot: 4 }
            : own.phase === 'power-allocation' && !self.powerAllocationConfirmed
            ? { ...base, type: 'allocate-power' as const, allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } }
            : own.phase === 'final-scientific-model' && !self.finalScientificModelSubmitted
            ? { ...base, type: 'submit-scientific-model' as const, scientificModel: { signals: { aster: { fieldType: 'phase' as const, polarity: 'positive' as const } } } }
            : null
          if (command) { await tender.execute(command, { expectedVersion: own.version }); humanAccepted = true; break }
        }
        expect(botPass.acceptedCommands > 0 || humanAccepted).toBe(true)
      }
      throw new Error('Mixed simple room exceeded command bound')
    } finally {
      if (roomId) await db!.tenderRoom.delete({ where: { id: roomId } })
      if (tenderId) await db!.tender.delete({ where: { id: tenderId } })
      await db!.user.deleteMany({ where: { id: { in: humans.map((item) => item.id) } } })
    }
  }, 30_000)
}
