import { afterAll, expect, test } from 'bun:test'
import { createPrisma } from '../../db'
import { createTenderModule, createPersistentCompletedTenderSummaryReader } from './index'
import { createPrismaTenderStore } from './infrastructure/prisma-tender-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const prisma = databaseUrl ? createPrisma(databaseUrl) : undefined
afterAll(async () => { await prisma?.$disconnect() })

test.skipIf(!prisma)('restores the immutable simple descriptor and never invents contracts on restart', async () => {
  const module = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  const { tenderId } = await module.createTender({ mode: 'simple', players: [{ id: 'simple-a', tiePriority: 1 }, { id: 'simple-b', tiePriority: 2 }] })
  const restored = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  const view = await restored.readTenderView({ tenderId, playerId: 'simple-a' })
  expect(view.game).toEqual({ mode: 'simple', rounds: 3, powerPerRound: 4, contracts: false, scoring: 'properties-12' })
  expect(view.publicContracts).toEqual([])
  expect(view.publicFinalContract).toBeUndefined()
  expect(view.availableSamplePool).toHaveLength(6)
  await prisma!.tender.delete({ where: { id: tenderId } })
})

test.skipIf(!prisma)('fails closed on a corrupted descriptor and keeps true legacy records standard v1', async () => {
  const module = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  const { tenderId } = await module.createTender({ players: [{ id: 'legacy-a', tiePriority: 1 }, { id: 'legacy-b', tiePriority: 2 }] })
  const record = await prisma!.tender.findUniqueOrThrow({ where: { id: tenderId } })
  const state = { ...(record.state as Record<string, unknown>) }
  delete state.game
  delete state.ruleset
  await prisma!.tender.update({ where: { id: tenderId }, data: { state: state as never } })
  expect(await module.readTenderView({ tenderId, playerId: 'legacy-a' })).toMatchObject({ game: { mode: 'standard' }, ruleset: 'tender-v1' })
  await prisma!.tender.update({ where: { id: tenderId }, data: { state: { ...state, game: { mode: 'unknown' } } as never } })
  await expect(module.readTenderView({ tenderId, playerId: 'legacy-a' })).rejects.toThrow()
  await prisma!.tender.delete({ where: { id: tenderId } })
})

test.skipIf(!prisma)('replays one random acquisition across concurrent requests and restart without a second draw', async () => {
  let module = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  const { tenderId } = await module.createTender({ mode: 'simple', players: [{ id: 'random-a', tiePriority: 1 }, { id: 'random-b', tiePriority: 2 }] })
  let sequence = 0
  const execute = (actorId: string, payload: object) => module.execute({ actorId, commandId: `random-${++sequence}`, tenderId, ...payload } as never)
  for (const actorId of ['random-a', 'random-b']) await execute(actorId, { type: 'request-access-slot', slot: 3 })
  for (const actorId of ['random-a', 'random-b']) await execute(actorId, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 0, modelAnalysis: 0, reserve: 2 } })
  const command = { actorId: 'random-a', commandId: 'random-concurrent', tenderId, type: 'conduct-reconnaissance' as const, targets: ['unknown-sector', 'unknown-sector'] as const }
  const receipts = await Promise.all([module.execute({ ...command, targets: [...command.targets] }), module.execute({ ...command, targets: [...command.targets] })])
  expect(receipts[0]).toEqual(receipts[1])
  const before = await module.readTenderView({ tenderId, playerId: 'random-a' })
  module = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  expect(await module.execute({ ...command, targets: [...command.targets] })).toEqual(receipts[0]!)
  expect(await module.readTenderView({ tenderId, playerId: 'random-a' })).toEqual({ ...before, serverTime: expect.any(String) })
  expect((await module.readTenderView({ tenderId, playerId: 'random-b' })).privateSamples).toEqual([])
  await expect(module.execute({ ...command, targets: ['aster', 'boreal'] })).rejects.toMatchObject({ kind: 'duplicate_command_conflict' })
  expect((await prisma!.tenderAuditEvent.findMany({ where: { tenderId, kind: 'reconnaissance_completed' } }))).toHaveLength(1)
  await prisma!.tender.delete({ where: { id: tenderId } })
})

test.skipIf(!prisma)('restores a simple no-submission result and keeps it readable by history and profile', async () => {
  const module = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  const { tenderId } = await module.createTender({ mode: 'simple', players: [{ id: 'unsent-a', tiePriority: 1 }, { id: 'unsent-b', tiePriority: 2 }] })
  let sequence = 0
  const command = (actorId: string, payload: object) => module.execute({ actorId, commandId: `unsent-${++sequence}`, tenderId, ...payload } as never)
  for (let round = 1; round <= 3; round++) {
    for (const actorId of ['unsent-a', 'unsent-b']) await command(actorId, { type: 'request-access-slot', slot: actorId === 'unsent-a' ? 3 : 4 })
    for (const actorId of ['unsent-a', 'unsent-b']) await command(actorId, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } })
  }
  const final = await module.readTenderView({ tenderId, playerId: 'unsent-a' })
  await module.advanceDueTenders({ now: new Date(final.dueAt!), limit: 10 })
  const restarted = createTenderModule({ store: createPrismaTenderStore(prisma!) })
  const result = await restarted.readTenderView({ tenderId, playerId: 'unsent-a' })
  expect(result.phase).toBe('complete')
  expect(result.winnerPlayerIds).toEqual([])
  expect(result.audit?.finalScientificModelsByPlayer['unsent-a']?.submitted).toBe(false)
  const summary = (await createPersistentCompletedTenderSummaryReader(prisma!).listCompletedMatches('unsent-a')).find((match) => match.mode === 'simple')
  expect(summary?.winnerPlayerIds).toEqual([])
  expect(summary?.players.find((p) => p.playerId === 'unsent-a')?.placement).toBe(1)
  await prisma!.tender.delete({ where: { id: tenderId } })
})

test.skipIf(!prisma)('normalizes simple mixed acquisition in the owner while replay keeps the original command fingerprint', async () => {
  const results: Array<{ samples: string[]; pool: string[] | undefined; version: number }> = []
  for (const targets of [['unknown-sector', 'boreal'], ['boreal', 'unknown-sector']] as const) {
    const store = createPrismaTenderStore(prisma!)
    let module = createTenderModule({ store, seedGenerator: () => 'order-review-seed' })
    const { tenderId } = await module.createTender({ mode: 'simple', players: [{ id: 'a', tiePriority: 1 }, { id: 'b', tiePriority: 2 }] })
    let sequence = 0
    const execute = (actorId: string, payload: object) => module.execute({ actorId, commandId: `batch-${++sequence}`, tenderId, ...payload } as never)
    await execute('a', { type: 'request-access-slot', slot: 3 })
    await execute('b', { type: 'request-access-slot', slot: 4 })
    for (const actorId of ['a', 'b']) await execute(actorId, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 0, modelAnalysis: 0, reserve: 2 } })
    const command = { actorId: 'a', commandId: 'batch-retry', tenderId, type: 'conduct-reconnaissance' as const, targets: [...targets] }
    const receipts = await Promise.all([module.execute(command), module.execute(command)])
    expect(receipts[0]).toEqual(receipts[1])
    expect(command.targets).toEqual([...targets])
    module = createTenderModule({ store: createPrismaTenderStore(prisma!) })
    expect(await module.execute(command)).toEqual(receipts[0]!)
    const reversed = [...targets].reverse() as typeof command.targets
    await expect(module.execute({ ...command, targets: reversed })).rejects.toMatchObject({ kind: 'duplicate_command_conflict' })
    const view = await module.readTenderView({ tenderId, playerId: 'a' })
    results.push({ samples: view.privateSamples, pool: view.availableSamplePool, version: view.version })
    const acquisitions = (await store.readAuditEvents(tenderId)).filter((event) => event.kind === 'reconnaissance_completed')
    expect(acquisitions).toHaveLength(1)
    expect((acquisitions[0]?.payload as Record<string, unknown> | undefined)?.targets).toEqual([...targets])
    await prisma!.tender.delete({ where: { id: tenderId } })
  }
  expect(results[0]).toEqual(results[1])
  expect(results[0]?.samples).toEqual(['boreal', 'ferro'])
})
