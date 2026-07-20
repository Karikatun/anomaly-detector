import { expect, test } from 'bun:test'

import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

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

  expect(await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:00:45.000Z') })).toEqual({
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

test('keeps Access Slot compensation for a player who acted before the deadline', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ actorId: 'player-a', commandId: 'access-slot-a-1', slot: 5, tenderId, type: 'request-access-slot' })
  await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:00:45.000Z') })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    privateAnalyticalReports: 2,
  })
})

test('resolves an expired Power allocation by reserving all remaining Power', async () => {
  const now = new Date('2026-07-20T12:00:00.000Z')
  const tender = createTenderModule({ now: () => now })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:00:45.000Z') })

  expect(await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:01:45.000Z') })).toEqual({
    advancedTenderIds: [tenderId],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'complete',
    players: [
      { playerId: 'player-a', powerAllocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } },
      { playerId: 'player-b', powerAllocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } },
    ],
  })
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

  expect(await tender.advanceDueTenders({ limit: 10, now: new Date('2026-07-20T12:00:20.000Z') })).toEqual({
    advancedTenderIds: [tenderId],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'complete',
    privateSamples: ['aster'],
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

  expect(await tender.execute(command)).toEqual({ tenderId, version: 1 })
  expect(await tender.execute(command)).toEqual({ tenderId, version: 1 })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toEqual({
    knownSignals: ['aster', 'boreal'],
    publicContracts: [
      { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
      { contractId: 'round-1-contract-2', requiredPublicResult: 'attenuation' },
      { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
    ],
    publicLaboratoryResults: [],
    round: 1,
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    players: [
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-b', rating: 0 },
    ],
    privateAnalyticalReports: 1,
    privateRawTelemetrySignals: ['aster'],
    privateMeasurements: [],
    privateSamples: ['aster'],
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

  expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toEqual({
    knownSignals: ['aster', 'boreal'],
    publicContracts: [
      { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
      { contractId: 'round-1-contract-2', requiredPublicResult: 'attenuation' },
      { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
    ],
    publicLaboratoryResults: [],
    round: 1,
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    players: [
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
      { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-b', rating: 0 },
    ],
    privateAnalyticalReports: 1,
    privateRawTelemetrySignals: ['aster'],
    privateMeasurements: [],
    privateSamples: ['aster'],
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

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toEqual({
    knownSignals: ['aster', 'boreal'],
    publicContracts: [
      { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
      { contractId: 'round-1-contract-2', requiredPublicResult: 'attenuation' },
      { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
      { contractId: 'round-1-contract-4', requiredPublicResult: 'unstable_collapse' },
      { contractId: 'round-1-contract-5', requiredPublicResult: 'reflection' },
    ],
    publicLaboratoryResults: [],
    round: 1,
    tenderId,
    version: 4,
    phase: 'power-allocation',
    players: [
      { accessSlot: 1, budget: 0, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-a', rating: 0 },
      { accessSlot: 3, budget: 2, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-b', rating: 0 },
      { accessSlot: 2, budget: 1, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-c', rating: 0 },
      { accessSlot: 6, budget: 3, contractPowerRestriction: 0, corporateTrust: 0, playerId: 'player-d', rating: 0 },
    ],
    privateAnalyticalReports: 1,
    privateRawTelemetrySignals: ['aster'],
    privateMeasurements: [],
    privateSamples: ['aster'],
    privateWorkingModel: { signals: {} },
    publicTheses: [],
  })

  expect(await tender.readTenderView({ tenderId, playerId: 'player-d' })).toMatchObject({
    knownSignals: ['aster', 'boreal'],
    privateRawTelemetrySignals: ['aster', 'boreal'],
    privateSamples: ['aster', 'boreal'],
    players: [
      { accessSlot: 1, budget: 0, playerId: 'player-a' },
      { accessSlot: 3, budget: 2, playerId: 'player-b' },
      { accessSlot: 2, budget: 1, playerId: 'player-c' },
      { accessSlot: 6, budget: 3, playerId: 'player-d' },
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
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 2, reconnaissance: 0 },
    actorId: 'player-a',
    commandId: 'a-1-power',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 2, reconnaissance: 0 },
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
    polarity: 'positive',
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

test('applies private Analytical Report compensation for the Night Access Slot', async () => {
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
    privateAnalyticalReports: 2,
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    privateAnalyticalReports: 1,
  })
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

test('opens Power allocation in Access Slot order and then opens Reconnaissance', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })

  await tender.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
  await tender.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })

  await expect(tender.execute({
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-b',
    commandId: 'command-b-2',
    tenderId,
    type: 'allocate-power',
  } as never)).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-a',
    commandId: 'command-a-2',
    tenderId,
    type: 'allocate-power',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'power-allocation',
    players: [
      {
        accessSlot: 1,
        powerAllocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
        playerId: 'player-a',
      },
      { accessSlot: 2 },
    ],
  })

  await tender.execute({
    allocation: { contracts: 0, laboratory: 2, modelAnalysis: 1, reconnaissance: 1 },
    actorId: 'player-b',
    commandId: 'command-b-3',
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
        powerAllocation: { contracts: 0, laboratory: 2, modelAnalysis: 1, reconnaissance: 1 },
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
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 1, reconnaissance: 1 },
    actorId: 'player-a',
    commandId: 'command-a-2',
    tenderId,
    type: 'allocate-power',
  } as never)
  await tender.execute({
    allocation: { contracts: 2, laboratory: 1, modelAnalysis: 0, reconnaissance: 1 },
    actorId: 'player-b',
    commandId: 'command-b-2',
    tenderId,
    type: 'allocate-power',
  } as never)

  await expect(tender.execute({
    actorId: 'player-b',
    commandId: 'command-b-3',
    signals: ['cinder'],
    tenderId,
    type: 'conduct-reconnaissance',
  } as never)).rejects.toMatchObject({ kind: 'invalid_tender_state' })

  await tender.execute({
    actorId: 'player-a',
    commandId: 'command-a-3',
    signals: ['cinder'],
    tenderId,
    type: 'conduct-reconnaissance',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder'],
    privateRawTelemetrySignals: ['aster', 'cinder'],
    privateSamples: ['aster', 'cinder'],
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder'],
    privateRawTelemetrySignals: ['aster'],
    privateSamples: ['aster'],
  })

  await tender.execute({
    actorId: 'player-b',
    commandId: 'command-b-4',
    signals: ['delta'],
    tenderId,
    type: 'conduct-reconnaissance',
  } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    knownSignals: ['aster', 'boreal', 'cinder', 'delta'],
    phase: 'laboratory',
    privateSamples: ['aster', 'cinder'],
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
  await tender.execute({ commandId: 'b-2', tenderId, actorId: 'player-b', type: 'allocate-power', allocation: { contracts: 2, laboratory: 0, modelAnalysis: 2, reconnaissance: 0 } })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })

  await tender.execute({ commandId: 'a-4', tenderId, actorId: 'player-a', type: 'run-laboratory-test', sourceSignal: 'cinder', receiverSignal: 'delta', protocol: 'continuous' } as never)

  expect(await tender.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
    phase: 'model-analysis',
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
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 0, laboratory: 0, modelAnalysis: 2, reconnaissance: 2 },
    actorId: 'player-c',
    commandId: 'c-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
  await tender.execute({ commandId: 'c-3', tenderId, actorId: 'player-c', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })

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
        verification: 'extended',
      },
    ],
  })
})

test('applies Model Analysis Rating rewards and wrong-Thesis Contract Power restrictions', async () => {
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
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 1, reconnaissance: 1 },
    actorId: 'player-a',
    commandId: 'a-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 1, reconnaissance: 1 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', signals: ['cinder'] })
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
    phase: 'contracts',
    players: [
      {
        contractPowerRestriction: 0,
        playerId: 'player-a',
        rating: 1,
      },
      {
        contractPowerRestriction: 1,
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
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-a',
    commandId: 'a-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({
    allocation: { contracts: 2, laboratory: 0, modelAnalysis: 0, reconnaissance: 2 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })

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

test('awards a reserved Contract Bid with matching public Laboratory evidence', async () => {
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
    allocation: { contracts: 0, laboratory: 0, modelAnalysis: 2, reconnaissance: 2 },
    actorId: 'player-b',
    commandId: 'b-2',
    tenderId,
    type: 'allocate-power',
  })
  await tender.execute({ commandId: 'a-3', tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
  await tender.execute({ commandId: 'b-3', tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
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

  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
    phase: 'access-slot-selection',
    round: 2,
    publicContracts: [
      {
        contractId: 'round-2-contract-1',
        requiredPublicResult: 'reflection',
      },
      { contractId: 'round-2-contract-2', requiredPublicResult: 'attenuation' },
      { contractId: 'round-2-contract-3', requiredPublicResult: 'transmission_gain' },
    ],
    players: [
      { budget: 3, corporateTrust: 1, playerId: 'player-a' },
      { budget: 2, corporateTrust: 0, playerId: 'player-b' },
    ],
  })
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
        ? { contracts: 2, laboratory: 0, modelAnalysis: 0, reconnaissance: 2 }
        : { contracts: 2, laboratory: 2, modelAnalysis: 0, reconnaissance: 0 },
      actorId: 'player-a',
      commandId: `a-${round}-power`,
      tenderId,
      type: 'allocate-power',
    })
    await tender.execute({
      allocation: round === 1
        ? { contracts: 2, laboratory: 0, modelAnalysis: 0, reconnaissance: 2 }
        : { contracts: 2, laboratory: 2, modelAnalysis: 0, reconnaissance: 0 },
      actorId: 'player-b',
      commandId: `b-${round}-power`,
      tenderId,
      type: 'allocate-power',
    })
    if (round === 1) {
      await tender.execute({ commandId: `a-${round}-recon`, tenderId, actorId: 'player-a', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
      await tender.execute({ commandId: `b-${round}-recon`, tenderId, actorId: 'player-b', type: 'conduct-reconnaissance', signals: ['cinder', 'delta'] })
    } else {
      await tender.execute({
        commandId: `a-${round}-lab`,
        tenderId,
        actorId: 'player-a',
        type: 'run-laboratory-test',
        sourceSignal: 'aster',
        receiverSignal: 'cinder',
        protocol: 'continuous',
      })
      await tender.execute({
        commandId: `b-${round}-lab`,
        tenderId,
        actorId: 'player-b',
        type: 'run-laboratory-test',
        sourceSignal: 'aster',
        receiverSignal: 'cinder',
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
    phase: 'complete',
    round: 5,
    audit: {
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
      privateMeasurementsByPlayer: {
        'player-a': expect.arrayContaining([
          expect.objectContaining({ receiverSignal: 'cinder', sourceSignal: 'aster' }),
        ]),
      },
    },
  })

  await expect(tender.execute({
    actorId: 'player-a',
    commandId: 'a-after-complete-working-model',
    tenderId,
    type: 'update-working-model',
    workingModel: { signals: { aster: { hypothesis: { fieldType: 'phase' } } } },
  })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})
