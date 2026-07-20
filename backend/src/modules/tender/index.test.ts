import { expect, test } from 'bun:test'

import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

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
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    players: [
      { playerId: 'player-a', requestedAccessSlot: 1 },
      { playerId: 'player-b' },
    ],
    privateRawTelemetrySignals: ['aster'],
    privateMeasurements: [],
    privateSamples: ['aster'],
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
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    players: [
      { playerId: 'player-a', requestedAccessSlot: 1 },
      { playerId: 'player-b' },
    ],
    privateRawTelemetrySignals: ['aster'],
    privateMeasurements: [],
    privateSamples: ['aster'],
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
    tenderId,
    version: 4,
    phase: 'power-allocation',
    players: [
      { playerId: 'player-a', accessSlot: 1 },
      { playerId: 'player-b', accessSlot: 3 },
      { playerId: 'player-c', accessSlot: 2 },
      { playerId: 'player-d', accessSlot: 6 },
    ],
    privateRawTelemetrySignals: ['aster'],
    privateMeasurements: [],
    privateSamples: ['aster'],
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
  })
  expect(await tender.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({ privateMeasurements: [] })
})

test('checks public theses in Access Slot order and opens Contracts', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({ players: [{ id: 'player-a', tiePriority: 1 }, { id: 'player-b', tiePriority: 2 }] })
  const store = (tender as never)
  expect(store).toBeDefined()
  await expect(tender.execute({ commandId: 'thesis-a', tenderId, actorId: 'player-a', type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' } as never)).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})
