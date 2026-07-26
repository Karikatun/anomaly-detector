import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createTenderModule } from './index'
import { createPrismaTenderStore } from './infrastructure/prisma-tender-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl
  ? describe
  : (name: string, fn: () => void) => describe.skip(name, fn)

maybeDescribe('Tender PostgreSQL integration', () => {
  if (!databaseUrl) return
  const prisma = createPrisma(databaseUrl!)

  beforeEach(async () => {
    await prisma.tender.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('persists an all-player leave deadline and completes it after a restart', async () => {
    const leftAt = new Date('2026-07-26T12:00:00.000Z')
    const firstModule = createTenderModule({
      now: () => leftAt,
      store: createPrismaTenderStore(prisma),
    })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })

    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'leave-a',
      tenderId,
      type: 'leave-tender',
    })
    await firstModule.execute({
      actorId: 'player-b',
      commandId: 'leave-b',
      tenderId,
      type: 'leave-tender',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      abandonmentDueAt: '2026-07-26T12:00:05.000Z',
      hasLeft: true,
      phase: 'access-slot-selection',
    })
    expect(await restartedModule.advanceDueTenders({
      limit: 10,
      now: new Date('2026-07-26T12:00:05.000Z'),
    })).toEqual({ advancedTenderIds: [tenderId] })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      abandonmentDueAt: null,
      completionReason: 'all_players_left',
      phase: 'complete',
      winnerPlayerIds: [],
    })
  })

  test('persists a due Access Slot deadline and resolves it after a restart', async () => {
    const createdAt = new Date('2026-07-20T12:00:00.000Z')
    const firstModule = createTenderModule({
      now: () => createdAt,
      store: createPrismaTenderStore(prisma),
    })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })

    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'access-slot-a-1',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })

    expect(await restartedModule.advanceDueTenders({
      limit: 10,
      now: new Date('2026-07-20T12:01:30.000Z'),
    })).toEqual({ advancedTenderIds: [tenderId] })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      phase: 'power-allocation',
      players: [
        { playerId: 'player-a', accessSlot: 1, budget: 0 },
        { playerId: 'player-b', accessSlot: 3, budget: 2 },
      ],
    })
    expect(await prisma.tenderAuditEvent.findMany({
      where: { tenderId, kind: 'access_slot_timeout_resolved' },
      select: { payload: true },
    })).toEqual([
      {
        payload: {
          accessSlots: { 'player-a': 1, 'player-b': 3 },
          budgetByPlayer: { 'player-a': 0, 'player-b': 2 },
          sampleCompensationByPlayer: {},
          timedOutPlayerIds: ['player-b'],
        },
      },
    ])
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).not.toHaveProperty('audit')
    expect(await createPrismaTenderStore(prisma).readAuditEvents(tenderId)).toMatchObject([
      {
        actorId: 'player-a',
        commandId: 'access-slot-a-1',
        kind: 'access_slot_requested',
        payload: { playerId: 'player-a', slot: 1 },
        sequence: 1,
      },
      {
        kind: 'access_slot_timeout_resolved',
        sequence: 2,
      },
    ])
  })

  test('restores a player view through a new PostgreSQL store adapter', async () => {
    const firstModule = createTenderModule({
      seedGenerator: () => 'seed-1',
      store: createPrismaTenderStore(prisma),
    })
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

    const restartedStore = createPrismaTenderStore(prisma)
    const restartedModule = createTenderModule({ store: restartedStore })

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      dueAt: expect.any(String),
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
        { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, displayName: 'player-a', playerId: 'player-a', rating: 0, requestedAccessSlot: 1, tiePriority: 1 },
        { budget: 2, contractPowerRestriction: 0, corporateTrust: 0, displayName: 'player-b', playerId: 'player-b', rating: 0, tiePriority: 2 },
      ],
      privateRawTelemetrySignals: [],
      privateMeasurements: [],
      privateSamples: [],
      privateWorkingModel: { signals: {} },
      publicTheses: [],
    })
    expect((await restartedStore.read(tenderId))?.anomalyConfiguration.seed).toBe('seed-1')

    expect(
      await prisma.tenderAuditEvent.findMany({
        where: { tenderId },
        orderBy: { sequence: 'asc' },
        select: { actorId: true, commandId: true, kind: true, payload: true, sequence: true },
      }),
    ).toEqual([
      {
        actorId: 'player-a',
        commandId: 'command-a-1',
        kind: 'access_slot_requested',
        payload: { playerId: 'player-a', slot: 1 },
        sequence: 1,
      },
    ])
  })

  test('persists an anonymised participant name without changing other players', async () => {
    const module = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1, displayName: 'Анна' },
        { id: 'player-b', tiePriority: 2, displayName: 'Борис' },
      ],
    })

    await module.anonymizeParticipant('player-a')

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      players: [
        { playerId: 'player-a', displayName: 'Deleted participant' },
        { playerId: 'player-b', displayName: 'Борис' },
      ],
    })
  })

  test('replays a persisted command receipt through a new PostgreSQL store adapter', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
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

    await firstModule.execute(command)

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })

    expect(await restartedModule.execute(command)).toEqual({ tenderId, version: 1 })
    await expect(restartedModule.execute({ ...command, slot: 2 })).rejects.toMatchObject({
      kind: 'duplicate_command_conflict',
    })
  })

  test('restores a player-owned Working Model through a new PostgreSQL store adapter', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })

    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'command-a-working-model-1',
      tenderId,
      type: 'update-working-model',
      workingModel: {
        signals: {
          aster: {
            excludedFieldTypes: ['phase'],
            hypothesis: { fieldType: 'inertial', polarity: 'positive' },
            note: 'Candidate source for reflection.',
          },
        },
      },
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      privateWorkingModel: {
        signals: {
          aster: {
            excludedFieldTypes: ['phase'],
            hypothesis: { fieldType: 'inertial', polarity: 'positive' },
            note: 'Candidate source for reflection.',
          },
        },
      },
    })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      privateWorkingModel: { signals: {} },
    })
  })

  test('persists resolved Access Slots and the phase transition', async () => {
    const module = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
        { id: 'player-c', tiePriority: 3 },
        { id: 'player-d', tiePriority: 4 },
      ],
    })

    await module.execute({
      commandId: 'command-a-1',
      tenderId,
      actorId: 'player-a',
      type: 'request-access-slot',
      slot: 1,
    })
    await module.execute({
      commandId: 'command-b-1',
      tenderId,
      actorId: 'player-b',
      type: 'request-access-slot',
      slot: 1,
    })
    await module.execute({
      commandId: 'command-c-1',
      tenderId,
      actorId: 'player-c',
      type: 'request-access-slot',
      slot: 2,
    })
    await module.execute({
      commandId: 'command-d-1',
      tenderId,
      actorId: 'player-d',
      type: 'request-access-slot',
      slot: 6,
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      dueAt: expect.any(String),
      knownSignals: ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'],
      publicContracts: [
        { contractId: 'round-1-contract-1', requiredPublicResult: 'reflection' },
        { contractId: 'round-1-contract-2', requiredPublicResult: 'attenuation' },
        { contractId: 'round-1-contract-3', requiredPublicResult: 'transmission_gain' },
        { contractId: 'round-1-contract-4', requiredPublicResult: 'unstable_collapse' },
        { contractId: 'round-1-contract-5', requiredPublicResult: 'reflection' },
      ],
      publicFinalContract: { contractId: 'final-contract', requiredPublicResult: 'reflection' },
      publicLaboratoryResults: [],
      round: 1,
      tenderId,
      version: 4,
      phase: 'power-allocation',
      players: [
        { accessSlot: 1, budget: 0, contractPowerRestriction: 0, corporateTrust: 0, displayName: 'player-a', playerId: 'player-a', rating: 0, tiePriority: 1 },
        { accessSlot: 3, budget: 2, contractPowerRestriction: 0, corporateTrust: 0, displayName: 'player-b', playerId: 'player-b', rating: 0, requestedAccessSlot: 1, tiePriority: 2 },
        { accessSlot: 2, budget: 1, contractPowerRestriction: 0, corporateTrust: 0, displayName: 'player-c', playerId: 'player-c', rating: 0, tiePriority: 3 },
        { accessSlot: 6, budget: 3, contractPowerRestriction: 0, corporateTrust: 0, displayName: 'player-d', playerId: 'player-d', rating: 0, tiePriority: 4 },
      ],
      privateRawTelemetrySignals: [],
      privateMeasurements: [],
      privateSamples: [],
      privateWorkingModel: { signals: {} },
      publicTheses: [],
    })

    expect(
      await prisma.tenderAuditEvent.findMany({
        where: { tenderId, kind: 'access_slots_resolved' },
        select: { payload: true, sequence: true },
      }),
    ).toEqual([
      {
        payload: {
          accessSlots: { 'player-a': 1, 'player-b': 3, 'player-c': 2, 'player-d': 6 },
          budgetByPlayer: { 'player-a': 0, 'player-b': 2, 'player-c': 1, 'player-d': 3 },
          sampleCompensationByPlayer: { 'player-d': 'aster' },
        },
        sequence: 5,
      },
    ])
  })

  test('keeps confirmed Power allocations private after a PostgreSQL restart', async () => {
    const createdAt = new Date('2026-07-20T12:00:00.000Z')
    const module = createTenderModule({ now: () => createdAt, store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })

    await module.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
    await module.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
    await module.execute({
      allocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 },
      actorId: 'player-a',
      commandId: 'command-a-2',
      tenderId,
      type: 'allocate-power',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
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
    const playerBView = await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })
    expect(playerBView.players[0]).not.toHaveProperty('powerAllocation')
    expect(playerBView.players[1]).not.toHaveProperty('powerAllocation')

    await restartedModule.advanceDueTenders({
      limit: 10,
      now: new Date('2026-07-20T12:01:30.000Z'),
    })

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      phase: 'reconnaissance',
      players: [
        { playerId: 'player-a', powerAllocation: { contracts: 1, laboratory: 1, modelAnalysis: 0, reconnaissance: 2 } },
        { playerId: 'player-b', powerAllocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } },
      ],
    })
    expect(await createPrismaTenderStore(prisma).readAuditEvents(tenderId)).toContainEqual(
      expect.objectContaining({
        kind: 'power_allocation_timeout_resolved',
        payload: { timedOutPlayerIds: ['player-b'] },
      }),
    )
  })

  test('restores player-scoped Reconnaissance data through a new PostgreSQL store adapter', async () => {
    const module = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })

    await module.execute({ commandId: 'command-a-1', tenderId, actorId: 'player-a', type: 'request-access-slot', slot: 1 })
    await module.execute({ commandId: 'command-b-1', tenderId, actorId: 'player-b', type: 'request-access-slot', slot: 2 })
    await module.execute({
      allocation: { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 1, reserve: 1 },
      actorId: 'player-a',
      commandId: 'command-a-2',
      tenderId,
      type: 'allocate-power',
    })
    await module.execute({
      allocation: { contracts: 1, laboratory: 0, modelAnalysis: 0, reconnaissance: 1, reserve: 2 },
      actorId: 'player-b',
      commandId: 'command-b-2',
      tenderId,
      type: 'allocate-power',
    })
    await module.execute({
      actorId: 'player-a',
      commandId: 'command-a-3',
      signals: ['cinder'],
      tenderId,
      type: 'conduct-reconnaissance',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      knownSignals: ['aster', 'boreal', 'cinder', 'ferro'],
      privateRawTelemetrySignals: ['cinder'],
      privateSamples: ['cinder'],
    })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      knownSignals: ['aster', 'boreal', 'cinder', 'ferro'],
      privateRawTelemetrySignals: [],
      privateMeasurements: [],
      privateSamples: [],
    })
  })
})
