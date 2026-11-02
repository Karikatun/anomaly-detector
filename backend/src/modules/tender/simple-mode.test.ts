import { expect, test } from 'bun:test'
import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'
import { createAnomalyConfiguration } from './domain/anomaly-configuration'
import { createCompletedTenderSummaryReader } from './application/tender-readers'

async function setup(count = 2) {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store, now: () => new Date('2026-11-02T12:00:00.000Z'), seedGenerator: () => 'simple-test-seed' })
  const players = Array.from({ length: count }, (_, index) => ({ id: String(index), tiePriority: index + 1 }))
  const { tenderId } = await tender.createTender({ mode: 'simple', players })
  let sequence = 0
  return {
    store, tender, tenderId, players,
    view: (playerId = '0') => tender.readTenderView({ tenderId, playerId }),
    command: (actorId: string, payload: object) => tender.execute({ actorId, commandId: `test-${++sequence}`, tenderId, ...payload } as never),
  }
}

for (const unequalBudget of [false, true]) test(`simple final timeout has no winner without any explicit model: unequal budget=${unequalBudget}`, async () => {
  const s = await setup()
  for (let round = 1; round <= 3; round++) {
    for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 3 : unequalBudget ? 4 : 5 })
    for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } })
  }
  await s.command('0', { type: 'update-scientific-model-draft', scientificModelDraft: { signals: createAnomalyConfiguration('simple-test-seed').signals } })
  await s.tender.advanceDueTenders({ now: new Date((await s.view()).dueAt!), limit: 10 })
  const completed = await s.view()
  expect(completed.phase).toBe('complete')
  expect(completed.winnerPlayerIds).toEqual([])
  expect(completed.players.map((p) => p.rating)).toEqual([0, 0])
  expect(completed.audit?.finalScientificModelsByPlayer['0']?.submitted).toBe(false)
  expect(completed.privateFinalScientificModelDraft).toBeUndefined()
  expect((await createCompletedTenderSummaryReader(s.store).listCompletedForPlayer('0'))[0]?.winnerPlayerIds).toEqual([])
})

test('simple evaluated zero-point final model ranks above an unsent draft with more budget', async () => {
  const s = await setup()
  for (let round = 1; round <= 3; round++) {
    for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 3 : 4 })
    for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } })
  }
  const actual = createAnomalyConfiguration('simple-test-seed').signals.aster
  await s.command('0', { type: 'submit-scientific-model', scientificModel: { signals: { aster: { polarity: actual.polarity === 'positive' ? 'negative' : 'positive' } } } })
  await s.command('1', { type: 'update-scientific-model-draft', scientificModelDraft: { signals: createAnomalyConfiguration('simple-test-seed').signals } })
  await s.tender.advanceDueTenders({ now: new Date((await s.view()).dueAt!), limit: 10 })
  const completed = await s.view()
  expect(completed.winnerPlayerIds).toEqual(['0'])
  expect(completed.audit?.placementByPlayer).toEqual({ '0': 1, '1': 2 })
  expect(completed.players.map((p) => p.rating)).toEqual([0, 0])
})

test('simple late-slot bonuses can fill the collection before allocation and never replace a full-set bonus with money', async () => {
  const s = await setup()
  for (let round = 1; round <= 2; round++) {
    for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 5 : 6 })
    for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 0, modelAnalysis: 0, reserve: 2 } })
    for (const p of s.players) await s.command(p.id, { type: 'conduct-reconnaissance', targets: ['unknown-sector', 'unknown-sector'] })
  }
  expect((await s.view()).privateSamples).toHaveLength(6)
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 5 : 6 })
  const full = await s.view()
  expect(full.privateSamples).toHaveLength(6)
  expect(full.availableSamplePool).toHaveLength(6)
  expect(full.players[0]?.budget).toBe(4)
  expect(full.players[1]?.budget).toBe(7)
  await expect(s.command('0', { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 1, laboratory: 0, modelAnalysis: 0, reserve: 3 } })).rejects.toThrow()
})

test('simple wrong first thesis at zero budget burns remaining analysis and resets review next round', async () => {
  const s = await setup()
  const actual = createAnomalyConfiguration('simple-test-seed').signals.aster
  await s.command('0', { type: 'request-access-slot', slot: 1 })
  await s.command('1', { type: 'request-access-slot', slot: 3 })
  for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 2, reserve: 2 } })
  const wrong = { type: 'submit-thesis', signalId: 'aster', fieldType: actual.fieldType === 'phase' ? 'inertial' : 'phase', polarity: actual.polarity }
  await s.command('0', wrong)
  const burned = await s.view()
  expect(burned.privateTheses).toHaveLength(1)
  expect(burned.players[0]?.modelAnalysisCompleted).toBe(true)
  expect(burned.players[0]?.budget).toBe(0)
  expect((await s.view('1')).privateTheses).toEqual([])
  await expect(s.command('0', wrong)).rejects.toThrow()
  await s.command('1', { type: 'submit-thesis', signalId: 'aster', ...actual })
  await s.command('1', { type: 'finish-model-analysis' })
  expect((await s.view()).round).toBe(2)
  expect((await s.view()).corporateReviewActive).toBe(false)
  expect((await s.view()).players[0]?.budget).toBe(1)
})

test('simple first correct thesis at zero budget still permits the free second thesis', async () => {
  const s = await setup()
  const configuration = createAnomalyConfiguration('simple-test-seed')
  await s.command('0', { type: 'request-access-slot', slot: 1 })
  await s.command('1', { type: 'request-access-slot', slot: 3 })
  for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 2, reserve: 2 } })
  await s.command('0', { type: 'submit-thesis', signalId: 'aster', ...configuration.signals.aster })
  expect((await s.view()).players[0]?.budget).toBe(0)
  expect((await s.view()).players[0]?.modelAnalysisCompleted).toBe(false)
  await s.command('0', { type: 'submit-thesis', signalId: 'boreal', ...configuration.signals.boreal })
  expect((await s.view()).privateTheses).toHaveLength(2)
  expect((await s.view()).players[0]?.budget).toBe(0)
  expect((await s.view()).players[0]?.modelAnalysisCompleted).toBe(true)
})

test('simple charges only one budget for the second thesis after an error and publishes the true budget', async () => {
  const s = await setup()
  const actual = createAnomalyConfiguration('simple-test-seed').signals.aster
  await s.command('0', { type: 'request-access-slot', slot: 2 })
  await s.command('1', { type: 'request-access-slot', slot: 3 })
  for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 2, reserve: 2 } })
  await s.command('0', { type: 'submit-thesis', signalId: 'aster', fieldType: actual.fieldType === 'phase' ? 'inertial' : 'phase', polarity: actual.polarity })
  expect((await s.view()).players[0]?.budget).toBe(1)
  await s.command('0', { type: 'submit-thesis', signalId: 'aster', ...actual })
  expect((await s.view('1')).players[0]?.budget).toBe(0)
  expect((await s.view('1')).privateTheses).toEqual([])
})

test('simple slot bonus closes the last missing sample before power allocation', async () => {
  const s = await setup()
  for (let round = 1; round <= 2; round++) {
    for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: round === 1 ? (p.id === '0' ? 5 : 6) : (p.id === '0' ? 3 : 4) })
    for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 0, modelAnalysis: 0, reserve: 2 } })
    for (const p of s.players) await s.command(p.id, { type: 'conduct-reconnaissance', targets: ['unknown-sector', 'unknown-sector'] })
  }
  expect((await s.view()).privateSamples).toHaveLength(5)
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 5 : 6 })
  expect((await s.view()).privateSamples).toHaveLength(6)
  await expect(s.command('0', { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 1, laboratory: 0, modelAnalysis: 0, reserve: 3 } })).rejects.toThrow()
})

test('simple awards exactly twelve points for a full model and uses server acceptance order after budget', async () => {
  const s = await setup()
  for (let round = 1; round <= 3; round++) {
    for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 3 : 5 })
    for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } })
  }
  const scientificModel = { signals: createAnomalyConfiguration('simple-test-seed').signals }
  await s.command('1', { type: 'submit-scientific-model', scientificModel })
  await s.command('0', { type: 'submit-scientific-model', scientificModel })
  const view = await s.view()
  expect(view.players.map((p) => p.rating)).toEqual([12, 12])
  expect(view.winnerPlayerIds).toEqual(['1'])
  expect(view.audit?.placementByPlayer).toEqual({ '0': 2, '1': 1 })
  expect(view.audit?.ratingBreakdownByPlayer['0']).toMatchObject({ correctPropertyPoints: 12, correctSignalPoints: 0, completeModelBonus: 0, thesisPoints: 0, total: 12 })
})

for (const count of [2, 3, 4]) test(`simple gives every displaced player a free fallback for ${count} participants`, async () => {
  const s = await setup(count)
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: 1 })
  const view = await s.view()
  expect(view.players[0]?.accessSlot).toBe(1)
  expect(view.players[0]?.budget).toBe(0)
  for (const p of view.players.slice(1)) {
    expect(p.accessSlot).toBeGreaterThanOrEqual(3)
    expect(p.budget).toBeGreaterThanOrEqual(2)
  }
})

test('simple hides research and allocations while direct depletion stays public and random copies remain legal', async () => {
  const s = await setup()
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: 3 })
  await s.command('0', { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 2, modelAnalysis: 0 } })
  await s.command('1', { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 2, modelAnalysis: 0 } })
  expect((await s.view('1')).players[0]?.powerAllocation).toBeUndefined()
  await s.command('0', { type: 'conduct-reconnaissance', targets: ['aster', 'boreal'] })
  const before = await s.view('1')
  expect(before.availableSamplePool).not.toContain('aster')
  expect(before.privateSamples).toEqual([])
  await expect(s.command('1', { type: 'conduct-reconnaissance', targets: ['aster', 'cinder'] })).rejects.toThrow()
  await s.command('1', { type: 'conduct-reconnaissance', targets: ['unknown-sector', 'unknown-sector'] })
  expect((await s.view()).availableSamplePool).toEqual(before.availableSamplePool)
  const own = await s.view('1')
  expect(new Set(own.privateSamples).size).toBe(2)
  await s.command('0', { type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } } })
  expect((await s.view()).publicScientificJournal).toHaveLength(1)
  const other = await s.view('1')
  expect(other.publicScientificJournal).toEqual([])
  expect(other.publicLaboratoryResults).toEqual([])
  expect(other.privateMeasurements).toEqual([])
  expect(other.audit).toBeUndefined()
  await expect(s.view('outsider')).rejects.toMatchObject({ kind: 'player_not_in_tender' })
})

test('simple permits random research after the complete direct pool is depleted', async () => {
  const s = await setup(4)
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: Number(p.id) + 1 })
  for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 0, modelAnalysis: 0, reserve: 2 } })
  for (const p of s.players.slice(0, 3)) {
    const targets = (await s.view(p.id)).availableSamplePool!.slice(0, 2)
    await s.command(p.id, { type: 'conduct-reconnaissance', targets })
  }
  expect((await s.view('3')).availableSamplePool).toEqual([])
  await s.command('3', { type: 'conduct-reconnaissance', targets: ['unknown-sector', 'unknown-sector'] })
  expect((await s.view('3')).privateSamples).toHaveLength(2)
  expect((await s.view('3')).round).toBe(2)
  expect((await s.view('3')).availableSamplePool).toHaveLength(6)
})

test('simple named and random targets resolve identically regardless of input order', async () => {
  const run = async (targets: Array<'unknown-sector' | 'boreal'>) => {
    const tender = createTenderModule({ seedGenerator: () => 'order-review-seed' })
    const { tenderId } = await tender.createTender({ mode: 'simple', players: [{ id: 'a', tiePriority: 1 }, { id: 'b', tiePriority: 2 }] })
    let sequence = 0
    const execute = (actorId: string, payload: object) => tender.execute({ actorId, commandId: `order-${++sequence}`, tenderId, ...payload } as never)
    await execute('a', { type: 'request-access-slot', slot: 3 })
    await execute('b', { type: 'request-access-slot', slot: 4 })
    for (const actorId of ['a', 'b']) await execute(actorId, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 0, modelAnalysis: 0, reserve: 2 } })
    await execute('a', { type: 'conduct-reconnaissance', targets })
    const view = await tender.readTenderView({ tenderId, playerId: 'a' })
    return { samples: view.privateSamples, pool: view.availableSamplePool, budget: view.players[0]?.budget, version: view.version }
  }
  const randomFirst = await run(['unknown-sector', 'boreal'])
  const namedFirst = await run(['boreal', 'unknown-sector'])
  expect(randomFirst).toEqual(namedFirst)
  expect(randomFirst.samples).toEqual(['boreal', 'ferro'])
  expect(randomFirst.pool).not.toContain('boreal')
})

test('simple rejects all contract commands atomically and does not publish private slot requests', async () => {
  const s = await setup()
  await s.command('0', { type: 'request-access-slot', slot: 1 })
  const observer = await s.view('1')
  expect(observer.players[0]?.requestedAccessSlot).toBeUndefined()
  expect(observer.players[0]?.requestedAccessSlotConfirmed).toBe(true)
  for (const payload of [{ type: 'reserve-contract', contractId: 'final-contract' }, { type: 'skip-contract' }, { type: 'submit-contract-bid', contractId: 'final-contract', evidenceTestIds: [] }]) {
    await expect(s.command('0', payload)).rejects.toThrow()
    expect((await s.view()).version).toBe(observer.version)
  }
})

test('simple forfeit cannot reveal an ongoing game but terminal audit returns to every participant', async () => {
  const s = await setup(3)
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: Number(p.id) + 3 })
  for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 2, laboratory: 2, modelAnalysis: 0 } })
  for (const p of s.players) await s.command(p.id, { type: 'conduct-reconnaissance', targets: ['unknown-sector', 'unknown-sector'] })
  const samples = (await s.view()).privateSamples
  await s.command('0', { type: 'run-laboratory-test', laboratory: { mode: 'deep', pair: { sourceSignal: samples[0], receiverSignal: samples[1] } } })
  await s.command('0', { type: 'forfeit-tender' })
  await expect(s.view('0')).rejects.toMatchObject({ kind: 'player_forfeited' })
  expect((await s.view('1')).publicScientificJournal).toEqual([])
  await s.command('1', { type: 'forfeit-tender' })
  expect((await s.view('0')).audit?.publicScientificJournal).toHaveLength(1)
  expect((await s.view('2')).audit?.privateMeasurementsByPlayer['0']).toHaveLength(1)
  await expect(s.view('outsider')).rejects.toMatchObject({ kind: 'player_not_in_tender' })
})

test('simple correct theses add no score and remain valid in the full completed audit', async () => {
  const s = await setup()
  const actual = createAnomalyConfiguration('simple-test-seed').signals.aster
  for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 3 : 5 })
  for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 1, reserve: 3 } })
  for (const p of s.players) await s.command(p.id, { type: 'submit-thesis', signalId: 'aster', ...actual })
  expect((await s.view()).players[0]?.rating).toBe(0)
  for (let round = 2; round <= 3; round++) {
    for (const p of s.players) await s.command(p.id, { type: 'request-access-slot', slot: p.id === '0' ? 3 : 5 })
    for (const p of s.players) await s.command(p.id, { type: 'allocate-power', allocation: { contracts: 0, reconnaissance: 0, laboratory: 0, modelAnalysis: 0, reserve: 4 } })
  }
  for (const p of s.players) await s.command(p.id, { type: 'submit-scientific-model', scientificModel: { signals: { aster: actual } } })
  const view = await s.view()
  expect(view.audit?.privateThesesByPlayer['1']).toHaveLength(1)
  expect(view.audit?.ratingBreakdownByPlayer['0']?.total).toBe(2)
  expect(view.winnerPlayerIds).toEqual(['0'])
})

test('simple completes three contract-free rounds with explicit ordered final submissions', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store, seedGenerator: () => 'simple-test-seed' })
  const { tenderId } = await tender.createTender({ mode: 'simple', players: [{ id: 'a', tiePriority: 1 }, { id: 'b', tiePriority: 2 }] })
  let commandNumber = 0
  const command = (actorId: string, payload: object) => tender.execute({ actorId, commandId: `cmd-${++commandNumber}`, tenderId, ...payload } as never)
  const view = () => tender.readTenderView({ tenderId, playerId: 'a' })
  expect((await view()).game?.mode).toBe('simple')
  expect((await view()).publicFinalContract).toBeUndefined()
  for (let round = 1; round <= 3; round++) {
    expect((await view()).round).toBe(round)
    for (const id of ['a', 'b']) await command(id, { type: 'request-access-slot', slot: 3 })
    await expect(command('a', { type: 'allocate-power', allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 3 } })).rejects.toThrow()
    for (const id of ['a', 'b']) await command(id, { type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } })
  }
  expect((await view()).phase).toBe('final-scientific-model')
  await command('b', { type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'phase', polarity: 'positive' } } } })
  await command('a', { type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'phase', polarity: 'positive' } } } })
  const result = await view()
  expect(result.phase).toBe('complete')
  expect(result.audit?.rounds).toHaveLength(3)
  expect(result.audit?.game?.mode).toBe('simple')
  expect(result.publicContracts).toEqual([])
  expect(result.audit?.ratingBreakdownByPlayer.a?.correctSignalPoints).toBe(0)
  expect(result.audit?.ratingBreakdownByPlayer.a?.thesisPoints).toBe(0)
})
