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

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toEqual({
      knownSignals: ['aster', 'boreal'],
      publicContracts: [
        { contractId: 'round-1-contract-1' },
        { contractId: 'round-1-contract-2' },
        { contractId: 'round-1-contract-3' },
      ],
      tenderId,
      version: 1,
      phase: 'access-slot-selection',
      players: [
        { contractPowerRestriction: 0, playerId: 'player-a', rating: 0, requestedAccessSlot: 1 },
        { contractPowerRestriction: 0, playerId: 'player-b', rating: 0 },
      ],
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
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

    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toEqual({
      knownSignals: ['aster', 'boreal'],
      publicContracts: [
        { contractId: 'round-1-contract-1' },
        { contractId: 'round-1-contract-2' },
        { contractId: 'round-1-contract-3' },
        { contractId: 'round-1-contract-4' },
        { contractId: 'round-1-contract-5' },
      ],
      tenderId,
      version: 4,
      phase: 'power-allocation',
      players: [
        { accessSlot: 1, contractPowerRestriction: 0, playerId: 'player-a', rating: 0 },
        { accessSlot: 3, contractPowerRestriction: 0, playerId: 'player-b', rating: 0 },
        { accessSlot: 2, contractPowerRestriction: 0, playerId: 'player-c', rating: 0 },
        { accessSlot: 6, contractPowerRestriction: 0, playerId: 'player-d', rating: 0 },
      ],
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
      publicTheses: [],
    })

    expect(
      await prisma.tenderAuditEvent.findMany({
        where: { tenderId, kind: 'access_slots_resolved' },
        select: { payload: true, sequence: true },
      }),
    ).toEqual([
      {
        payload: { accessSlots: { 'player-a': 1, 'player-b': 3, 'player-c': 2, 'player-d': 6 } },
        sequence: 5,
      },
    ])
  })

  test('restores open Power allocations through a new PostgreSQL store adapter', async () => {
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
      allocation: { contracts: 1, laboratory: 1, modelAnalysis: 1, reconnaissance: 1 },
      actorId: 'player-a',
      commandId: 'command-a-2',
      tenderId,
      type: 'allocate-power',
    })
    await module.execute({
      allocation: { contracts: 2, laboratory: 1, modelAnalysis: 0, reconnaissance: 1 },
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
      knownSignals: ['aster', 'boreal', 'cinder'],
      privateRawTelemetrySignals: ['aster', 'cinder'],
      privateSamples: ['aster', 'cinder'],
    })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      knownSignals: ['aster', 'boreal', 'cinder'],
      privateRawTelemetrySignals: ['aster'],
      privateMeasurements: [],
      privateSamples: ['aster'],
    })
  })
})
