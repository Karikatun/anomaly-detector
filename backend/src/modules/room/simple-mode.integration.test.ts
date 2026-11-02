import { afterAll, expect, test } from 'bun:test'
import { createPrisma } from '../../db'
import { createPersistentTenderModule, createPersistentCompletedTenderSummaryReader } from '../tender'
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
