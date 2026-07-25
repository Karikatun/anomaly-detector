import { expect, test } from 'bun:test'

import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

test('gives every live phase a 90-second deadline', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    dueAt: '2026-07-20T12:01:30.000Z',
    phase: 'access-slot-selection',
  })

  await tender.execute({ actorId: 'player-a', commandId: 'slot-a', slot: 1, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-b', commandId: 'slot-b', slot: 2, tenderId, type: 'request-access-slot' })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    dueAt: '2026-07-20T12:01:30.000Z',
    phase: 'power-allocation',
  })
})

test('rejects Power allocations with more Reconnaissance than missing Samples', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  const initial = await store.read(tenderId)
  if (!initial) throw new Error('Tender was not created')
  await store.commit({
    auditEvents: [],
    expectedVersion: initial.version,
    nextTender: {
      ...initial,
      accessSlots: { 'player-a': 1, 'player-b': 2 },
      phase: 'power-allocation',
      samplesByPlayer: {
        ...initial.samplesByPlayer,
        'player-a': ['aster', 'boreal', 'cinder', 'delta', 'eclipse'],
      },
    },
    tenderId,
  })

  await expect(tender.execute({
    actorId: 'player-a',
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
    commandId: 'power-a',
    tenderId,
    type: 'allocate-power',
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})

test('rejects Laboratory power when planned Reconnaissance cannot provide two Samples', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  const initial = await store.read(tenderId)
  if (!initial) throw new Error('Tender was not created')
  await store.commit({
    auditEvents: [],
    expectedVersion: initial.version,
    nextTender: {
      ...initial,
      accessSlots: { 'player-a': 1, 'player-b': 2 },
      phase: 'power-allocation',
    },
    tenderId,
  })

  await expect(tender.execute({
    actorId: 'player-a',
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 1, reconnaissance: 1 },
    commandId: 'power-a',
    tenderId,
    type: 'allocate-power',
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})

test('builds a reproducible seeded Contract deck with one contract of every required type', async () => {
  const first = createTenderModule({ seedGenerator: () => 'deck-seed' })
  const second = createTenderModule({ seedGenerator: () => 'deck-seed' })
  const players = [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }, { id: 'player-c', tiePriority: 3 }]
  const [firstTender, secondTender] = await Promise.all([first.createTender({ players }), second.createTender({ players })])
  const [firstView, secondView] = await Promise.all([
    first.readTenderView({ tenderId: firstTender.tenderId, playerId: 'player-a' }),
    second.readTenderView({ tenderId: secondTender.tenderId, playerId: 'player-a' }),
  ])

  expect(firstView.publicContracts).toEqual(secondView.publicContracts)
  expect(firstView.publicContracts.map((contract) => contract.kind)).toEqual(['scientific', 'complex', 'light', 'light'])
  expect(firstView.publicFinalContract).toMatchObject({ kind: 'final', ratingReward: 8 })
})

test('awards a Light Contract once and permanently consumes its journal evidence', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store, seedGenerator: () => 'evidence-seed' })
  const { tenderId } = await tender.createTender({ players: [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }] })
  const initial = await store.read(tenderId)
  if (!initial) throw new Error('Tender was not created')
  const contract = {
    contractId: 'evidence-contract-1', kind: 'light' as const, ratingReward: 2,
    requiredPublicResult: 'reflection' as const, targetRole: 'source' as const, targetSignal: 'aster' as const,
  }
  const prepared = {
    ...initial,
    accessSlots: { 'player-a': 1, 'player-b': 2 },
    phase: 'contracts' as const,
    powerAllocations: {
      'player-a': { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 3 },
      'player-b': { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 },
    },
    publicContracts: [contract],
    publicScientificJournal: [{ testId: 'r1-t1', playerId: 'player-a', protocol: 'impulse' as const, sourceSignal: 'aster' as const, receiverSignal: 'boreal' as const, publicResult: 'reflection' as const }],
    round: 5,
  }
  await store.commit({ auditEvents: [], expectedVersion: initial.version, nextTender: prepared, tenderId })
  await tender.execute({ actorId: 'player-a', commandId: 'reserve-first', contractId: contract.contractId, tenderId, type: 'reserve-contract' })
  await tender.execute({ actorId: 'player-a', commandId: 'bid-first', contractId: contract.contractId, evidenceTestIds: ['r1-t1'], tenderId, type: 'submit-contract-bid' })
  const afterAward = await store.read(tenderId)
  expect(afterAward?.usedContractEvidenceTestIds).toEqual(['r1-t1'])
  expect(afterAward?.ratingByPlayer['player-a']).toBe(2)

  if (!afterAward) throw new Error('Tender disappeared')
  const second = { ...contract, contractId: 'evidence-contract-2' }
  const retry = { ...afterAward, contractCompletedByPlayer: {}, phase: 'contracts' as const, publicContracts: [second] }
  await store.commit({ auditEvents: [], expectedVersion: afterAward.version, nextTender: retry, tenderId })
  await tender.execute({ actorId: 'player-a', commandId: 'reserve-second', contractId: second.contractId, tenderId, type: 'reserve-contract' })
  await tender.execute({ actorId: 'player-a', commandId: 'bid-second', contractId: second.contractId, evidenceTestIds: ['r1-t1'], tenderId, type: 'submit-contract-bid' })
  expect((await store.read(tenderId))?.publicContracts[0]).toMatchObject({ bidOutcome: 'failed' })
})

test('starts without Samples, reveals only Contract-named Signals, and publishes a Night Slot Sample name', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  const initialView = await tender.readTenderView({ tenderId, playerId: 'player-a' })
  expect(initialView.privateSamples).toEqual([])
  expect(initialView).not.toHaveProperty('privateAnalyticalReports')
  expect(initialView.knownSignals).toEqual(['aster', 'boreal', 'cinder', 'ferro'])

  await tender.execute({ actorId: 'player-a', commandId: 'access-slot-a-1', slot: 5, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-b', commandId: 'access-slot-b-1', slot: 3, tenderId, type: 'request-access-slot' })

  const playerAView = await tender.readTenderView({ tenderId, playerId: 'player-a' })
  const playerBView = await tender.readTenderView({ tenderId, playerId: 'player-b' })
  expect(playerAView.privateSamples).toHaveLength(1)
  expect(playerBView.privateSamples).toEqual([])
  expect(playerAView.privateSamples).toEqual(['delta'])
  expect(playerBView.knownSignals).toContain(playerAView.privateSamples[0]!)
})

test('acquires deterministic Samples from Unknown Sectors for use in the same round Laboratory phase', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ actorId: 'player-a', commandId: 'access-slot-a-1', slot: 1, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-b', commandId: 'access-slot-b-1', slot: 2, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-a', allocation: { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 2 }, commandId: 'power-a-1', tenderId, type: 'allocate-power' })
  await tender.execute({ actorId: 'player-b', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 }, commandId: 'power-b-1', tenderId, type: 'allocate-power' })

  await tender.execute({ actorId: 'player-a', commandId: 'recon-a-1', targets: ['unknown-sector', 'unknown-sector'], tenderId, type: 'conduct-reconnaissance' } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'laboratory',
    privateSamples: ['delta', 'eclipse'],
  })
  await expect(tender.execute({ actorId: 'player-a', commandId: 'lab-a-1', protocol: 'continuous', receiverSignal: 'eclipse', sourceSignal: 'delta', tenderId, type: 'run-laboratory-test' })).resolves.toMatchObject({ tenderId })
})

test('writes Continuous tests to the public Scientific Journal while keeping private telemetry player-scoped', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({ players: [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }] })
  await tender.execute({ actorId: 'player-a', commandId: 'slot-a', slot: 1, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-b', commandId: 'slot-b', slot: 2, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-a', allocation: { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 2 }, commandId: 'power-a', tenderId, type: 'allocate-power' })
  await tender.execute({ actorId: 'player-b', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 }, commandId: 'power-b', tenderId, type: 'allocate-power' })
  await tender.execute({ actorId: 'player-a', commandId: 'recon-a', targets: ['unknown-sector', 'unknown-sector'], tenderId, type: 'conduct-reconnaissance' } as never)
  await tender.execute({ actorId: 'player-a', commandId: 'lab-a', protocol: 'continuous', receiverSignal: 'eclipse', sourceSignal: 'delta', tenderId, type: 'run-laboratory-test' })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    publicScientificJournal: [{ playerId: 'player-a', protocol: 'continuous', receiverSignal: 'eclipse', sourceSignal: 'delta', testId: 'r1-t1' }],
    privateTelemetry: [{ receiverSignal: 'eclipse', sourceSignal: 'delta', polarityRelation: expect.any(String) }],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    publicScientificJournal: [{ testId: 'r1-t1' }],
    privateTelemetry: [],
  })
})

test('creates Research Certifications for correct Theses and charges later Theses during Corporate Review', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({ players: [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }] })
  await tender.execute({ actorId: 'player-a', commandId: 'slot-a', slot: 1, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-b', commandId: 'slot-b', slot: 2, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-a', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 1, reconnaissance: 2, reserve: 1 }, commandId: 'power-a', tenderId, type: 'allocate-power' })
  await tender.execute({ actorId: 'player-b', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 1, reconnaissance: 2, reserve: 1 }, commandId: 'power-b', tenderId, type: 'allocate-power' })
  await tender.execute({ actorId: 'player-a', commandId: 'recon-a', targets: ['unknown-sector', 'unknown-sector'], tenderId, type: 'conduct-reconnaissance' } as never)
  await tender.execute({ actorId: 'player-b', commandId: 'recon-b', targets: ['aster', 'boreal'], tenderId, type: 'conduct-reconnaissance' })

  await tender.execute({ actorId: 'player-a', commandId: 'thesis-a', fieldType: 'inertial', polarity: 'positive', signalId: 'aster', tenderId, type: 'submit-thesis' })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({ corporateReviewActive: true, privateResearchCertifications: [] })
  await tender.execute({ actorId: 'player-b', commandId: 'thesis-b', fieldType: 'phase', polarity: 'positive', signalId: 'boreal', tenderId, type: 'submit-thesis' })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({ players: [{ playerId: 'player-a' }, { playerId: 'player-b', budget: 1 }] })
})

test('resolves an expired Access Slot selection with conservative free defaults', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'access-slot-a-1',
    slot: 1,
    tenderId,
    type: 'request-access-slot',
  })

  expect(await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:01:30.000Z') })).toMatchObject({
    advancedTenderIds: [tenderId],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    phase: 'power-allocation',
    players: [
      { playerId: 'player-a', accessSlot: 1, budget: 0 },
      { playerId: 'player-b', accessSlot: 3, budget: 2 },
    ],
  })
})

test('keeps a Night Access Slot Sample for a player who acted before the deadline', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ actorId: 'player-a', commandId: 'access-slot-a-1', slot: 5, tenderId, type: 'request-access-slot' })
  await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:01:30.000Z') })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    privateSamples: ['delta'],
  })
})

test('resolves every missing Power allocation together when the shared deadline expires', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:01:30.000Z') })

  expect(await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:03:00.000Z') })).toMatchObject({
    advancedTenderIds: [tenderId],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    dueAt: '2026-07-20T12:04:30.000Z',
    phase: 'access-slot-selection',
    round: 2,
    players: [
      { playerId: 'player-a', budget: 3 },
      { playerId: 'player-b', budget: 3 },
    ],
  })
})

test('completes five rounds for every supported player count when all players reserve Power', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  for (const playerCount of [2, 3, 4]) {
    const tender = createTenderModule({ now: () => now })
    const players = Array.from({ length: playerCount }, (_, index) => ({
      id: `player-${index + 1}`,
      tiePriority: index + 1,
    }))
    const { tenderId } = await tender.createTender({ players })

    let dueAt = now
    for (let round = 1; round <= 5; round += 1) {
      dueAt = new Date(dueAt.getTime() + 90_000)
      await tender.advanceDueTenders({ limit: 10, now: dueAt })
      dueAt = new Date(dueAt.getTime() + 90_000)
      await tender.advanceDueTenders({ limit: 10, now: dueAt })
    }

    expect(await tender.readTenderView({ tenderId, playerId: players[0].id })).toMatchObject({
      phase: 'final-scientific-model',
      round: 5,
      players: players.map((player) => ({ playerId: player.id, budget: 7 })),
    })

    for (const player of players) {
      dueAt = new Date(dueAt.getTime() + 90_000)
      await tender.advanceDueTenders({ limit: 10, now: dueAt })
    }

    expect(await tender.readTenderView({ tenderId, playerId: players[0].id })).toMatchObject({
      phase: 'complete',
      winnerPlayerIds: players.map((player) => player.id),
    })
  }
})

test('awards property points, completed Signal points, and the complete-model bonus at final audit', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now, seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }],
  })
  let dueAt = now
  for (let round = 1; round <= 5; round += 1) {
    dueAt = new Date(dueAt.getTime() + 90_000)
    await tender.advanceDueTenders({ limit: 10, now: dueAt })
    dueAt = new Date(dueAt.getTime() + 90_000)
    await tender.advanceDueTenders({ limit: 10, now: dueAt })
  }

  await tender.execute({
    actorId: 'player-a',
    commandId: 'final-model-a',
    tenderId,
    type: 'submit-scientific-model',
    scientificModel: {
      signals: {
        aster: { fieldType: 'inertial', polarity: 'negative' },
        boreal: { fieldType: 'inertial', polarity: 'positive' },
        cinder: { fieldType: 'electromagnetic', polarity: 'negative' },
        delta: { fieldType: 'phase', polarity: 'negative' },
        eclipse: { fieldType: 'electromagnetic', polarity: 'positive' },
        ferro: { fieldType: 'phase', polarity: 'positive' },
      },
    },
  })

  const finalModelView = await tender.readTenderView({ tenderId, playerId: 'player-a' })
  expect(finalModelView).toMatchObject({
    phase: 'final-scientific-model',
  })
  expect(finalModelView.players.find((player) => player.playerId === 'player-a')).toMatchObject({ rating: 21 })
})

test('skips an unresolved operational action when its deadline expires', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ actorId: 'player-a', commandId: 'access-slot-a-1', slot: 3, tenderId, type: 'request-access-slot' })
  await tender.execute({ actorId: 'player-b', commandId: 'access-slot-b-1', slot: 4, tenderId, type: 'request-access-slot' })
  await tender.execute({
    actorId: 'player-a',
    allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 1, reserve: 3 },
    commandId: 'power-a-1',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    actorId: 'player-b',
    allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 },
    commandId: 'power-b-1',
    tenderId,
    type: 'allocate-power',
  })

  expect(await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:01:30.000Z') })).toMatchObject({
    advancedTenderIds: [tenderId],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'access-slot-selection',
    round: 2,
    privateSamples: [],
  })
})

test('records an Access Slot command once and exposes it only to its player', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  const command = {
    commandId: 'command-a-1',
    tenderId,
    actorId: 'player-a',
    type: 'request-access-slot' as const,
    slot: 1,
  }

  expect(await tender.execute(command)).toMatchObject({ tenderId, version: 1 })
  expect(await tender.execute(command)).toMatchObject({ tenderId, version: 1 })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    publicContracts: [
      { contractId: 'round-1-contract-1', kind: 'scientific' },
      { contractId: 'round-1-contract-2', kind: 'complex' },
      { contractId: 'round-1-contract-3', kind: 'light' },
    ],
    publicFinalContract: { contractId: 'final-contract', kind: 'final', ratingReward: 8 },
    publicLaboratoryResults: [],
    round: 1,
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    players: [
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-b', rating: 0 },
    ],
    privateRawTelemetrySignals: [],
    privateMeasurements: [],
    privateSamples: [],
    privateWorkingModel: { signals: {} },
    publicTheses: [],
  })
})

test('does not return a Tender view to a non-player', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await expect(tender.readTenderView({ tenderId, playerId: 'player-c' })).rejects.toMatchObject({
    kind: 'player_not_in_tender',
  })
})

test('anonymises a deleted participant in every Tender view', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1, displayName: 'Анна' },
      { id: 'player-b', tiePriority: 2, displayName: 'Борис' },
    ],
  })

  await tender.anonymizeParticipant('player-a')

  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    players: [
      { playerId: 'player-a', displayName: 'Deleted participant' },
      { playerId: 'player-b', displayName: 'Борис' },
    ],
  })
})

test('does not expose the post-match audit before the Tender is complete', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'working-model-a-1',
    tenderId,
    type: 'update-working-model',
    workingModel: { signals: { aster: { note: 'Private draft.' } } },
  })

  await expect(tender.readTenderView({ tenderId, playerId: 'player-a' })).resolves.not.toHaveProperty('audit')
  await expect(tender.readTenderView({ tenderId, playerId: 'player-b' })).resolves.not.toHaveProperty('audit')
})

test('stores a player-owned Working Model without exposing it to other players', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'working-model-a-1',
    tenderId,
    type: 'update-working-model',
    workingModel: {
      signals: {
        aster: {
          excludedFieldTypes: ['phase'],
          hypothesis: { fieldType: 'inertial', polarity: 'positive' },
          note: 'Aster behaves like a stable source.',
          possiblePolarities: ['positive'],
        },
      },
    },
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'access-slot-selection',
    players: [
      { playerId: 'player-a', rating: 0 },
      { playerId: 'player-b', rating: 0 },
    ],
    privateWorkingModel: {
      signals: {
        aster: {
          excludedFieldTypes: ['phase'],
          hypothesis: { fieldType: 'inertial', polarity: 'positive' },
          note: 'Aster behaves like a stable source.',
          possiblePolarities: ['positive'],
        },
      },
    },
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    privateWorkingModel: { signals: {} },
  })
})

test('identifies an unknown Tender with a stable failure kind', async () => {
  const tender = createTenderModule()

  await expect(tender.readTenderView({ tenderId: 'missing-tender', playerId: 'player-a' })).rejects.toMatchObject({
    kind: 'tender_not_found',
  })
})

test('rejects a commandId reused for a different Access Slot command', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({
    commandId: 'command-a-1',
    tenderId,
    actorId: 'player-a',
    type: 'request-access-slot',
    slot: 1,
  })

  await expect(
    tender.execute({
      commandId: 'command-a-1',
      tenderId,
      actorId: 'player-a',
      type: 'request-access-slot',
      slot: 2,
    }),
  ).rejects.toMatchObject({ kind: 'duplicate_command_conflict' })
})

test('rejects an Access Slot command outside the shared contract', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await expect(
    tender.execute({
      commandId: 'command-a-7',
      tenderId,
      actorId: 'player-a',
      type: 'request-access-slot',
      slot: 7,
    } as never),
  ).rejects.toMatchObject({ kind: 'invalid_tender_command' })
})

test('rejects a Tender with fewer than two players', async () => {
  const tender = createTenderModule()

  await expect(
    tender.createTender({
      players: [{ id: 'player-a', tiePriority: 1 }],
    } as never),
  ).rejects.toMatchObject({ kind: 'invalid_create_tender' })
})

test('rejects an invalid Tender view query before checking participation', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await expect(
    tender.readTenderView({ tenderId, playerId: '' } as never),
  ).rejects.toMatchObject({ kind: 'invalid_tender_view_query' })
})

test('restores a player Tender view from the shared store', async () => {
  const store = createInMemoryTenderStore()
  const firstModule = createTenderModule({ store })
  const { tenderId } = await firstModule.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await firstModule.execute({
    commandId: 'command-a-1',
    tenderId,
    actorId: 'player-a',
    type: 'request-access-slot',
    slot: 1,
  })

  const restartedModule = createTenderModule({ store })

  expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder', 'ferro'],
    publicContracts: [
      { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
      { contractId: 'round-1-contract-2', requiredPublicResult: 'attenuation' },
      { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
    ],
    publicFinalContract: { contractId: 'final-contract', requiredPublicResult: 'reflection' },
    publicLaboratoryResults: [],
    round: 1,
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    players: [
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-b', rating: 0 },
    ],
    privateRawTelemetrySignals: [],
    privateMeasurements: [],
    privateSamples: [],
    privateWorkingModel: { signals: {} },
    publicTheses: [],
  })
})

test('stores a seed-derived Anomaly Configuration without exposing it in a Tender view', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store, seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  expect(await store.read(tenderId)).toMatchObject({
    anomalyConfiguration: { seed: 'seed-1' },
  })
  await expect(tender.readTenderView({ tenderId, playerId: 'player-a' })).resolves.not.toHaveProperty(
    'anomalyConfiguration',
  )
})

test('resolves Access Slots and opens Power planning after every player chooses', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
      { id: 'player-c', tiePriority: 3 },
      { id: 'player-d', tiePriority: 4 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'command-c-1', tenderId, actorId: 'player-c', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'command-d-1', tenderId, actorId: 'player-d', type: 'request-access-slot', slot: 6 })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    publicContracts: [
      { contractId: 'round-1-contract-1', kind: 'scientific' },
      { contractId: 'round-1-contract-2', kind: 'complex' },
      { contractId: 'round-1-contract-3', kind: 'light' },
      { contractId: 'round-1-contract-4', kind: 'light' },
      { contractId: 'round-1-contract-5', kind: 'light' },
    ],
    publicFinalContract: { contractId: 'final-contract', kind: 'final' },
    publicLaboratoryResults: [],
    round: 1,
    tenderId,
    version: 4,
    phase: 'power-allocation',
    players: [
      { accessSlot: 1, budget: 0, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1, tiePriority: 1 },
      { accessSlot: 3, budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-b', rating: 0 },
      { accessSlot: 2, budget: 1, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-c', rating: 0 },
      { accessSlot: 6, budget: 3, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-d', rating: 0 },
    ],
    privateRawTelemetrySignals: [],
    privateMeasurements: [],
    privateSamples: [],
    privateWorkingModel: { signals: {} },
    publicTheses: [],
  })

  const playerDView = await tender.readTenderView({ tenderId, playerId: 'player-d' })
  expect(playerDView).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'],
    privateRawTelemetrySignals: [],
    privateSamples: ['aster'],
    players: [
      { accessSlot: 1, budget: 0, playerId: 'player-a' },
      { accessSlot: 3, budget: 2, playerId: 'player-b' },
      { accessSlot: 2, budget: 1, playerId: 'player-c' },
      { accessSlot: 6, budget: 3, playerId: 'player-d' },
    ],
  })
  expect(playerDView.players.find((player) => player.playerId === 'player-a')).not.toHaveProperty('requestedAccessSlot')
})

test('grants the documented budget compensation for Access Slot 4', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 4 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 3 })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'power-allocation',
    players: [
      { accessSlot: 4, budget: 3, playerId: 'player-a' },
      { accessSlot: 3, budget: 2, playerId: 'player-b' },
    ],
  })
})

test('rotates Access Slot tie priority between rounds', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1-slot', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1-slot', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 1 })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    round: 1,
    players: [
      { accessSlot: 1, playerId: 'player-a' },
      { accessSlot: 2, playerId: 'player-b' },
    ],
  })

  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 0, reserve: 2 },
    actorId: 'player-a',
    commandId: 'a-1-power',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 0, reserve: 2 },
    actorId: 'player-b',
    commandId: 'b-1-power',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    commandId: 'a-1-thesis',
    tenderId,
    actorId: 'player-a',
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'inertial',
    polarity: 'negative',
  })
  await tender.execute({
    commandId: 'b-1-thesis',
    tenderId,
    actorId: 'player-b',
    type: 'submit-thesis',
    signalId: 'boreal',
    fieldType: 'inertial',
    polarity: 'positive',
  })
  await tender.execute({
    actorId: 'player-a',
    commandId: 'a-1-reserve',
    contractId: 'round-1-contract-1',
    tenderId,
    type: 'reserve-contract',
  })
  await tender.execute({
    actorId: 'player-a',
    claimedPublicResult: 'reflection',
    commandId: 'a-1-bid',
    contractId: 'round-1-contract-1',
    requestedFunding: 1,
    tenderId,
    type: 'submit-contract-bid',
  })
  await tender.execute({
    actorId: 'player-b',
    commandId: 'b-1-reserve',
    contractId: 'round-1-contract-2',
    tenderId,
    type: 'reserve-contract',
  })
  await tender.execute({
    actorId: 'player-b',
    claimedPublicResult: 'attenuation',
    commandId: 'b-1-bid',
    contractId: 'round-1-contract-2',
    requestedFunding: 1,
    tenderId,
    type: 'submit-contract-bid',
  })

  await tender.execute({ commandId: 'a-2-slot', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-2-slot', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 1 })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    round: 2,
    players: [
      { accessSlot: 2, playerId: 'player-a' },
      { accessSlot: 1, playerId: 'player-b' },
    ],
  })
})

test('applies a private Sample compensation for the Night Access Slot', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 5 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 3 })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    players: [
      { accessSlot: 5, budget: 2, playerId: 'player-a' },
      { accessSlot: 3, budget: 2, playerId: 'player-b' },
    ],
    privateSamples: ['delta'],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({ privateSamples: [] })
})

test('rejects an Access Slot command after Power planning opens', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })

  await expect(
    tender.execute({ commandId: 'command-a-2', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 3 }),
  ).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})

test('keeps confirmed Power allocations private until every player confirms, then opens Reconnaissance', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })

  await tender.execute({
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-b',
    commandId: 'command-b-2',
    tenderId,
    type: 'allocate-power',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'power-allocation',
    players: [
      { accessSlot: 1, playerId: 'player-a', powerAllocationConfirmed: false },
      { accessSlot: 2, playerId: 'player-b', powerAllocationConfirmed: true },
    ],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    phase: 'power-allocation',
    players: [
      { accessSlot: 1, playerId: 'player-a' },
      {
        accessSlot: 2,
        powerAllocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
        powerAllocationConfirmed: true,
        playerId: 'player-b',
      },
    ],
  })

  await tender.execute({
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-a',
    commandId: 'command-a-2',
    tenderId,
    type: 'allocate-power',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'reconnaissance',
    players: [
      {
        accessSlot: 1,
        powerAllocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
        playerId: 'player-a',
      },
      {
        accessSlot: 2,
        powerAllocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
        playerId: 'player-b',
      },
    ],
  })
})

test('makes newly acquired Signals public while keeping Samples and Raw Telemetry private', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 1, reserve: 1 },
    actorId: 'player-a',
    commandId: 'command-a-2',
    tenderId,
    type: 'allocate-power',
  } as never)
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 1, reserve: 2 },
    actorId: 'player-b',
    commandId: 'command-b-2',
    tenderId,
    type: 'allocate-power',
  } as never)

  await expect(tender.execute({
    actorId: 'player-b',
    commandId: 'command-b-3',
    targets: ['cinder'],
    tenderId,
    type: 'conduct-reconnaissance',
  } as never)).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'command-a-3',
    targets: ['cinder'],
    tenderId,
    type: 'conduct-reconnaissance',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder', 'ferro'],
    privateRawTelemetrySignals: ['cinder'],
    privateSamples: ['cinder'],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder', 'ferro'],
    privateRawTelemetrySignals: [],
    privateSamples: [],
  })

  await tender.execute({
    actorId: 'player-b',
    commandId: 'command-b-4',
    targets: ['unknown-sector'],
    tenderId,
    type: 'conduct-reconnaissance',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'model-analysis',
    privateSamples: ['cinder'],
  })
})

test('resolves a continuous Laboratory test between a Player\'s Samples', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'a-2', tenderId, actorId: 'player-a', type: 'allocate-power', allocation: { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 2 } })
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })

  await tender.execute({ commandId: 'a-4', tenderId, actorId: 'player-a', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'delta', protocol: 'continuous' } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'access-slot-selection',
    round: 2,
    privateMeasurements: [{ receiverSignal: 'delta', sourceSignal: 'cinder', polarityRelation: expect.any(String) }],
    publicLaboratoryResults: [{
      playerId: 'player-a',
      protocol: 'continuous',
      publicResult: expect.any(String),
      receiverSignal: 'delta',
      sourceSignal: 'cinder',
    }],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    privateMeasurements: [],
    publicLaboratoryResults: [{
      playerId: 'player-a',
      protocol: 'continuous',
      publicResult: expect.any(String),
      receiverSignal: 'delta',
      sourceSignal: 'cinder',
    }],
  })
})

test('checks public Theses in Access Slot order and opens Contracts', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
      { id: 'player-c', tiePriority: 3 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'c-1', tenderId, actorId: 'player-c', type: 'request-access-slot', slot: 3 })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 2 },
    actorId: 'player-a',
    commandId: 'a-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 0, laboratory: 0, modelAnalysis: 1, reconnaissance: 2, reserve: 1 },
    actorId: 'player-c',
    commandId: 'c-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['aster', 'boreal'] })
  await tender.execute({ commandId: 'c-3', tenderId, actorId: 'player-c', type: 'conduct-reconnaissance', targets: ['aster', 'boreal'] })

  await expect(
    tender.execute({
      commandId: 'c-4',
      tenderId,
      actorId: 'player-c',
      type: 'submit-thesis',
      signalId: 'aster',
      fieldType: 'phase',
      polarity: 'negative',
    }),
  ).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    commandId: 'a-4',
    tenderId,
    actorId: 'player-a',
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'inertial',
    polarity: 'negative',
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    phase: 'model-analysis',
    publicTheses: [{
      correct: true,
      fieldType: 'inertial',
      playerId: 'player-a',
      polarity: 'negative',
      signalId: 'aster',
      verification: 'standard',
    }],
  })

  await tender.execute({
    commandId: 'c-5',
    tenderId,
    actorId: 'player-c',
    type: 'submit-thesis',
    signalId: 'boreal',
    fieldType: 'phase',
    polarity: 'positive',
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'contracts',
    publicTheses: [
      {
        correct: true,
        fieldType: 'inertial',
        playerId: 'player-a',
        polarity: 'negative',
        signalId: 'aster',
        verification: 'standard',
      },
      {
        correct: false,
        fieldType: 'phase',
        playerId: 'player-c',
        polarity: 'positive',
        signalId: 'boreal',
        verification: 'standard',
      },
    ],
  })
})

test('awards Research Certification and activates Corporate Review after a wrong Thesis', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 1, reserve: 1 },
    actorId: 'player-a',
    commandId: 'a-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 1, reserve: 1 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder'] })
  await tender.execute({
    commandId: 'a-4',
    tenderId,
    actorId: 'player-a',
    type: 'submit-thesis',
    signalId: 'aster',
    fieldType: 'inertial',
    polarity: 'negative',
  })
  await tender.execute({
    commandId: 'b-4',
    tenderId,
    actorId: 'player-b',
    type: 'submit-thesis',
    signalId: 'boreal',
    fieldType: 'phase',
    polarity: 'positive',
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    corporateReviewActive: true,
    privateResearchCertifications: ['aster'],
    phase: 'contracts',
    players: [
      {
        contractPowerRestriction: 0,
        playerId: 'player-a',
        rating: 1,
      },
      {
        budget: 1,
        contractPowerRestriction: 0,
        playerId: 'player-b',
        rating: 0,
      },
    ],
  })
})

test('reserves public Contracts in Access Slot order', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    publicContracts: [
      { contractId: 'round-1-contract-1' },
      { contractId: 'round-1-contract-2' },
      { contractId: 'round-1-contract-3' },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 },
    actorId: 'player-a',
    commandId: 'a-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })

  await expect(tender.execute({
    actorId: 'player-b',
    commandId: 'b-4',
    contractId: 'round-1-contract-1',
    tenderId,
    type: 'reserve-contract',
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'a-4',
    contractId: 'round-1-contract-2',
    tenderId,
    type: 'reserve-contract',
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    phase: 'contracts',
    publicContracts: [
      { contractId: 'round-1-contract-1' },
      { contractId: 'round-1-contract-2', reservedByPlayerId: 'player-a' },
      { contractId: 'round-1-contract-3' },
    ],
  })

  await expect(tender.execute({
    actorId: 'player-b',
    commandId: 'b-5',
    contractId: 'round-1-contract-2',
    tenderId,
    type: 'reserve-contract',
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    actorId: 'player-a',
    claimedPublicResult: 'attenuation',
    commandId: 'a-5',
    contractId: 'round-1-contract-2',
    requestedFunding: 3,
    tenderId,
    type: 'submit-contract-bid',
  })

  await expect(tender.execute({
    actorId: 'player-b',
    commandId: 'b-6',
    contractId: 'round-1-contract-2',
    tenderId,
    type: 'reserve-contract',
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    actorId: 'player-b',
    commandId: 'b-7',
    contractId: 'round-1-contract-3',
    tenderId,
    type: 'reserve-contract',
  })

  await tender.execute({
    actorId: 'player-b',
    claimedPublicResult: 'transmission_gain',
    commandId: 'b-8',
    contractId: 'round-1-contract-3',
    requestedFunding: 2,
    tenderId,
    type: 'submit-contract-bid',
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'access-slot-selection',
    round: 2,
    publicContracts: [
      { contractId: 'round-2-contract-1' },
      { contractId: 'round-2-contract-2' },
      { contractId: 'round-2-contract-3' },
    ],
    players: [
      { budget: 1, corporateTrust: 0, playerId: 'player-a' },
      { budget: 2, corporateTrust: 0, playerId: 'player-b' },
    ],
  })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'a-9',
    tenderId,
    type: 'request-access-slot',
    slot: 3,
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'access-slot-selection',
    round: 2,
    players: [
      { playerId: 'player-a', requestedAccessSlot: 3 },
      { playerId: 'player-b' },
    ],
  })
})

test('does not award a Contract from removed claim and funding fields', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-a',
    commandId: 'a-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 0, laboratory: 0, modelAnalysis: 1, reconnaissance: 2, reserve: 1 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({
    commandId: 'a-4',
    tenderId,
    actorId: 'player-a',
    type: 'run-laboratory-test',
    sourceSignal: 'cinder',
    receiverSignal: 'delta',
    protocol: 'impulse',
  })
  await tender.execute({
    commandId: 'b-4',
    tenderId,
    actorId: 'player-b',
    type: 'submit-thesis',
    signalId: 'boreal',
    fieldType: 'inertial',
    polarity: 'positive',
  })
  await tender.execute({
    actorId: 'player-a',
    commandId: 'a-5',
    contractId: 'round-1-contract-1',
    tenderId,
    type: 'reserve-contract',
  })

  await expect(tender.execute({
    actorId: 'player-b',
    claimedPublicResult: 'reflection',
    commandId: 'b-5',
    contractId: 'round-1-contract-1',
    requestedFunding: 1,
    tenderId,
    type: 'submit-contract-bid',
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    actorId: 'player-a',
    claimedPublicResult: 'reflection',
    commandId: 'a-6',
    contractId: 'round-1-contract-1',
    requestedFunding: 2,
    tenderId,
    type: 'submit-contract-bid',
  })

  const view = await tender.readTenderView({ tenderId, playerId: 'player-b' })
  expect(view).toMatchObject({
    phase: 'access-slot-selection',
    round: 2,
  })
  expect(view.publicContracts[0]).toMatchObject({ contractId: 'round-2-contract-1', kind: 'scientific' })
  expect(view.players.find((player) => player.playerId === 'player-a')).toMatchObject({ budget: 1, corporateTrust: 0, rating: 0 })
})

test('completes the Tender after Contracts in round five', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  for (let round = 1; round <= 5; round += 1) {
    await tender.execute({ commandId: `a-${round}-slot`, tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 3 })
    await tender.execute({ commandId: `b-${round}-slot`, tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 4 })
    await tender.execute({
      allocation: round === 1
        ? { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 }
        : { contracts: 1, laboratory: 2, modelAnalysis: 0, reconnaissance: 0, reserve: 1 },
      actorId: 'player-a',
      commandId: `a-${round}-power`,
      tenderId,
      type: 'allocate-power',
    })
    await tender.execute({
      allocation: round === 1
        ? { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 }
        : { contracts: 1, laboratory: 2, modelAnalysis: 0, reconnaissance: 0, reserve: 1 },
      actorId: 'player-b',
      commandId: `b-${round}-power`,
      tenderId,
      type: 'allocate-power',
    })
    if (round === 1) {
      await tender.execute({ commandId: `a-${round}-recon`, tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
      await tender.execute({ commandId: `b-${round}-recon`, tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
    } else {
      await tender.execute({
        commandId: `a-${round}-lab`,
        tenderId,
        actorId: 'player-a',
        type: 'run-laboratory-test',
        sourceSignal: 'cinder',
        receiverSignal: 'delta',
        protocol: 'continuous',
      })
      await tender.execute({
        commandId: `b-${round}-lab`,
        tenderId,
        actorId: 'player-b',
        type: 'run-laboratory-test',
        sourceSignal: 'cinder',
        receiverSignal: 'eclipse',
        protocol: 'continuous',
      })
    }
    await tender.execute({
      actorId: 'player-a',
      commandId: `a-${round}-reserve`,
      contractId: `round-${round}-contract-1`,
      tenderId,
      type: 'reserve-contract',
    })
    await tender.execute({
      actorId: 'player-a',
      claimedPublicResult: 'unstable_collapse',
      commandId: `a-${round}-bid`,
      contractId: `round-${round}-contract-1`,
      requestedFunding: 1,
      tenderId,
      type: 'submit-contract-bid',
    })
    await tender.execute({
      actorId: 'player-b',
      commandId: `b-${round}-reserve`,
      contractId: `round-${round}-contract-2`,
      tenderId,
      type: 'reserve-contract',
    })
    await tender.execute({
      actorId: 'player-b',
      claimedPublicResult: 'reflection',
      commandId: `b-${round}-bid`,
      contractId: `round-${round}-contract-2`,
      requestedFunding: 1,
      tenderId,
      type: 'submit-contract-bid',
    })
  }

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'final-scientific-model',
    round: 5,
  })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'a-final-model',
    scientificModel: { signals: { aster: { fieldType: 'inertial' } } },
    tenderId,
    type: 'submit-scientific-model',
  })
  await tender.execute({
    actorId: 'player-b',
    commandId: 'b-final-model',
    scientificModel: { signals: { aster: { fieldType: 'inertial' } } },
    tenderId,
    type: 'submit-scientific-model',
  })

  const completedView = await tender.readTenderView({ tenderId, playerId: 'player-a' })
  expect(completedView).toMatchObject({
    phase: 'complete',
    players: [
      { budget: 7, playerId: 'player-a' },
      { budget: 12, playerId: 'player-b' },
    ],
    round: 5,
    winnerPlayerIds: ['player-b'],
  })
  expect(completedView.audit).toMatchObject({
    anomalyConfiguration: {
      seed: expect.any(String),
      signals: expect.objectContaining({
        aster: { fieldType: expect.any(String), polarity: expect.any(String) },
      }),
    },
    events: expect.arrayContaining([
      expect.objectContaining({ actorId: 'player-a', commandId: 'a-1-slot', kind: 'access_slot_requested', sequence: 1 }),
      expect.objectContaining({ actorId: 'player-a', commandId: 'a-2-lab', kind: 'laboratory_test_completed' }),
      expect.objectContaining({ actorId: 'player-b', commandId: 'b-5-bid', kind: 'contract_bid_assessed' }),
    ]),
  })
  expect(completedView.audit?.privateMeasurementsByPlayer['player-a']).toEqual(expect.arrayContaining([
    expect.objectContaining({ receiverSignal: 'delta', sourceSignal: 'cinder' }),
  ]))

  await expect(tender.execute({
    actorId: 'player-a',
    commandId: 'a-after-complete-working-model',
    tenderId,
    type: 'update-working-model',
    workingModel: { signals: { aster: { hypothesis: { fieldType: 'phase' } } } },
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})

test('projects public Laboratory results into the participant audit view', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  for (let round = 1; round <= 5; round += 1) {
    await tender.execute({ commandId: `a-${round}-slot`, tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 3 })
    await tender.execute({ commandId: `b-${round}-slot`, tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 4 })
    await tender.execute({
      allocation: round === 1
        ? { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 }
        : { contracts: 1, laboratory: 2, modelAnalysis: 0, reconnaissance: 0, reserve: 1 },
      actorId: 'player-a',
      commandId: `a-${round}-power`,
      tenderId,
      type: 'allocate-power',
    })
    await tender.execute({
      allocation: round === 1
        ? { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 }
        : { contracts: 1, laboratory: 2, modelAnalysis: 0, reconnaissance: 0, reserve: 1 },
      actorId: 'player-b',
      commandId: `b-${round}-power`,
      tenderId,
      type: 'allocate-power',
    })
    if (round === 1) {
      await tender.execute({ commandId: `a-${round}-recon`, tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
      await tender.execute({ commandId: `b-${round}-recon`, tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
    } else {
      await tender.execute({ commandId: `a-${round}-lab`, tenderId, actorId: 'player-a', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'delta', protocol: 'continuous' })
      await tender.execute({ commandId: `b-${round}-lab`, tenderId, actorId: 'player-b', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'eclipse', protocol: 'continuous' })
    }
    await tender.execute({ commandId: `a-${round}-reserve`, tenderId, actorId: 'player-a', type: 'reserve-contract', contractId: `round-${round}-contract-1` })
    await tender.execute({ commandId: `a-${round}-bid`, tenderId, actorId: 'player-a', type: 'submit-contract-bid', contractId: `round-${round}-contract-1`, claimedPublicResult: 'unstable_collapse', requestedFunding: 1 })
    await tender.execute({ commandId: `b-${round}-reserve`, tenderId, actorId: 'player-b', type: 'reserve-contract', contractId: `round-${round}-contract-2` })
    await tender.execute({ commandId: `b-${round}-bid`, tenderId, actorId: 'player-b', type: 'submit-contract-bid', contractId: `round-${round}-contract-2`, claimedPublicResult: 'reflection', requestedFunding: 1 })
  }

  await tender.execute({ commandId: 'a-final-model', tenderId, actorId: 'player-a', type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'inertial' } } } })
  await tender.execute({ commandId: 'b-final-model', tenderId, actorId: 'player-b', type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'inertial' } } } })

  const view = await tender.readTenderView({ tenderId, playerId: 'player-a' })
  expect(view.phase).toBe('complete')
  expect(view.audit).toBeDefined()
  expect(view.audit!.publicLaboratoryResults.length).toBeGreaterThanOrEqual(1)
  expect(view.audit!.publicLaboratoryResults).toMatchObject(
    expect.arrayContaining([
      expect.objectContaining({
        playerId: 'player-a',
        protocol: 'continuous',
        publicResult: expect.any(String),
        receiverSignal: 'cinder',
        sourceSignal: 'aster',
      }),
    ]),
  )
})

test('produces no private measurement for an impulse Laboratory test', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'a-2', tenderId, actorId: 'player-a', type: 'allocate-power', allocation: { contracts: 0, laboratory: 1, modelAnalysis: 0, reconnaissance: 2, reserve: 1 } as never })
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 2 } as never })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'a-4', tenderId, actorId: 'player-a', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'delta', protocol: 'impulse' })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    privateMeasurements: [],
    publicLaboratoryResults: [{
      playerId: 'player-a',
      protocol: 'impulse',
      publicResult: expect.any(String),
      receiverSignal: 'delta',
      sourceSignal: 'cinder',
    }],
  })
})

test('rejects a continuous protocol when only one Laboratory power is allocated', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'a-2', tenderId, actorId: 'player-a', type: 'allocate-power', allocation: { contracts: 0, laboratory: 1, modelAnalysis: 0, reconnaissance: 2, reserve: 1 } })
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 2 } as never })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['aster', 'boreal'] })

  await expect(
    tender.execute({ commandId: 'a-4', tenderId, actorId: 'player-a', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'delta', protocol: 'continuous' }),
  ).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})

test('rejects a Final Contract reservation below two Corporate Trust', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'a-2', tenderId, actorId: 'player-a', type: 'allocate-power', allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 } })
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 1 } })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })

  await expect(
    tender.execute({ commandId: 'a-4', tenderId, actorId: 'player-a', type: 'reserve-contract', contractId: 'final-contract' }),
  ).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})

test('rejects a self-directed Laboratory test', async () => {
  const tender = createTenderModule({ seedGenerator: () => 'seed-1' })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'a-2', tenderId, actorId: 'player-a', type: 'allocate-power', allocation: { contracts: 0, laboratory: 1, modelAnalysis: 0, reconnaissance: 2, reserve: 1 } })
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 2 } as never })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', targets: ['cinder', 'unknown-sector'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', targets: ['aster', 'boreal'] })

  await expect(
    tender.execute({ commandId: 'a-4', tenderId, actorId: 'player-a', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'cinder', protocol: 'impulse' }),
  ).rejects.toMatchObject({ kind: 'invalid_tender_command' })
})

test('rejects Reconnaissance with duplicate Signal ids', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  await tender.execute({ commandId: 'a-2', tenderId, actorId: 'player-a', type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 2 } as never })
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 2, reserve: 2 } as never })

  await expect(
    tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder', 'cinder'] }),
  ).rejects.toMatchObject({ kind: 'invalid_tender_command' })
})

test('allows Working Model updates during the power-allocation phase', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
  const receipt = await tender.execute({
    actorId: 'player-a',
    commandId: 'wm-1',
    tenderId,
    type: 'update-working-model',
    workingModel: { signals: { aster: { note: 'Taking notes during planning.' } } },
  })
  expect(receipt).toMatchObject({ tenderId, version: 3 })
})

test('advanceDueTenders skips a completed Tender whose phase has no deadline', async () => {
  let now = new Date('2026-07-21T12:00:00Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  for (let i = 0; i < 20; i += 1) {
    now = new Date(now.getTime() + 150_000)
    await tender.advanceDueTenders({ limit: 10, now })
  }

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'complete',
  })
  now = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  expect(await tender.advanceDueTenders({ limit: 10, now })).toMatchObject({ advancedTenderIds: [] })
})
