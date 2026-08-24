import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'
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

  test('persists a permanent forfeit and restores participant audit access after early completion', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
        { id: 'player-c', tiePriority: 3 },
      ],
    })
    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'forfeit-a',
      tenderId,
      type: 'forfeit-tender',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    await expect(restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).rejects.toMatchObject({
      kind: 'player_forfeited',
    })
    await restartedModule.execute({
      actorId: 'player-b',
      commandId: 'forfeit-b',
      tenderId,
      type: 'forfeit-tender',
    })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      audit: {
        rounds: expect.any(Array),
      },
      completionReason: 'last_active_player',
      phase: 'complete',
      winnerPlayerIds: ['player-c'],
    })
  })

  test('fails closed when a completed Tender contains an unsupported persisted audit event', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })
    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'forfeit-a-corrupted-audit',
      tenderId,
      type: 'forfeit-tender',
    })
    await prisma.tenderAuditEvent.update({
      where: { tenderId_sequence: { sequence: 1, tenderId } },
      data: { payload: { data: {}, formatVersion: 999 } },
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const view = await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })

    expect(view).toMatchObject({
      phase: 'complete',
      winnerPlayerIds: ['player-b'],
    })
    expect(view).not.toHaveProperty('audit')
    expect(view).not.toHaveProperty('auditUnavailableReason')
  })

  test('omits the completed audit when a persisted legacy event is missing participant semantics', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })
    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'forfeit-a-legacy-audit',
      tenderId,
      type: 'forfeit-tender',
    })
    await prisma.tenderAuditEvent.update({
      where: { tenderId_sequence: { sequence: 1, tenderId } },
      data: {
        kind: 'power_allocated',
        payload: {},
      },
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const view = await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })

    expect(view).toMatchObject({
      phase: 'complete',
      winnerPlayerIds: ['player-b'],
    })
    expect(view).not.toHaveProperty('audit')
    expect(view).not.toHaveProperty('auditUnavailableReason')
  })

  test('does not mask malformed current persisted audit data as historical incompatibility', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })
    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'forfeit-a-current-audit-corruption',
      tenderId,
      type: 'forfeit-tender',
    })
    await prisma.tenderAuditEvent.update({
      where: { tenderId_sequence: { sequence: 1, tenderId } },
      data: {
        kind: 'power_allocated',
        payload: { data: {}, formatVersion: 1 },
      },
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    await expect(restartedModule.readTenderView({ tenderId, playerId: 'player-b' }))
      .rejects.toMatchObject({
        kind: 'current_corruption',
        name: 'TenderAuditEventDecodeError',
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
          data: {
            accessSlots: { 'player-a': 1, 'player-b': 3 },
            budgetByPlayer: { 'player-a': 0, 'player-b': 2 },
            sampleCompensationByPlayer: {},
            timedOutPlayerIds: ['player-b'],
          },
          formatVersion: 1,
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
      ruleset: 'tender-v2',
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
        payload: {
          data: { playerId: 'player-a', slot: 1 },
          formatVersion: 1,
        },
        sequence: 1,
      },
    ])
  })

  test('fails closed with a validation error for corrupted persisted Tender state', async () => {
    const tender = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await tender.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })
    await prisma.tender.update({
      where: { id: tenderId },
      data: {
        state: {
          players: 'corrupted',
        },
      },
    })

    const restarted = createTenderModule({ store: createPrismaTenderStore(prisma) })
    await expect(restarted.readTenderView({
      playerId: 'player-a',
      tenderId,
    })).rejects.toMatchObject({ name: 'ZodError' })
  })

  test('decodes known legacy audit events through the Prisma store boundary', async () => {
    const module = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })
    await prisma.tenderAuditEvent.create({
      data: {
        kind: 'access_slots_resolved',
        payload: { accessSlots: { 'player-a': 1, 'player-b': 2 } },
        sequence: 1,
        tenderId,
      },
    })

    await expect(createPrismaTenderStore(prisma).readAuditEvents(tenderId)).resolves.toEqual([{
      formatVersion: 0,
      kind: 'access_slots_resolved',
      payload: { accessSlots: { 'player-a': 1, 'player-b': 2 } },
      sequence: 1,
    }])
  })

  test('fails closed for an unsupported persisted audit event version', async () => {
    const module = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1 },
        { id: 'player-b', tiePriority: 2 },
      ],
    })
    await prisma.tenderAuditEvent.create({
      data: {
        kind: 'access_slot_requested',
        payload: {
          data: { playerId: 'player-a', slot: 1 },
          formatVersion: 2,
        },
        sequence: 1,
        tenderId,
      },
    })

    await expect(createPrismaTenderStore(prisma).readAuditEvents(tenderId))
      .rejects.toThrow('Unsupported Tender audit event format version 2')
  })

  test('keeps in-memory and Prisma audit store contracts equivalent', async () => {
    const inMemoryStore = createInMemoryTenderStore()
    const prismaStore = createPrismaTenderStore(prisma)
    const options = {
      now: () => new Date('2026-07-20T12:00:00.000Z'),
      seedGenerator: () => 'audit-contract-seed',
    }
    const inMemoryModule = createTenderModule({ ...options, store: inMemoryStore })
    const prismaModule = createTenderModule({ ...options, store: prismaStore })
    const players = [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ]
    const inMemoryTender = await inMemoryModule.createTender({ players })
    const prismaTender = await prismaModule.createTender({ players })

    await inMemoryModule.execute({
      actorId: 'player-a',
      commandId: 'access-slot-a',
      slot: 1,
      tenderId: inMemoryTender.tenderId,
      type: 'request-access-slot',
    })
    await prismaModule.execute({
      actorId: 'player-a',
      commandId: 'access-slot-a',
      slot: 1,
      tenderId: prismaTender.tenderId,
      type: 'request-access-slot',
    })

    expect(await prismaStore.readAuditEvents(prismaTender.tenderId))
      .toEqual(await inMemoryStore.readAuditEvents(inMemoryTender.tenderId))
  })

  test('persists an anonymised participant name without changing other players', async () => {
    const module = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await module.createTender({
      players: [
        { id: 'player-a', tiePriority: 1, displayName: 'Анна' },
        { id: 'player-b', tiePriority: 2, displayName: 'Борис' },
      ],
    })
    await module.execute({
      actorId: 'player-a',
      commandId: 'delete-history-command',
      slot: 1,
      tenderId,
      type: 'request-access-slot',
    })

    await module.anonymizeParticipant('player-a')
    await module.execute({
      actorId: 'player-b',
      commandId: 'complete-after-anonymisation',
      tenderId,
      type: 'forfeit-tender',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const view = await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })
    expect(JSON.stringify(view)).not.toContain('player-a')
    expect(view).toMatchObject({
      audit: { rounds: expect.any(Array) },
      phase: 'complete',
    })
    expect(view.players).toContainEqual(expect.objectContaining({
      displayName: 'Deleted participant',
      playerId: expect.stringMatching(/^deleted-participant-/),
    }))
    const auditEvents = await prisma.tenderAuditEvent.findMany({
      where: { tenderId },
      select: { actorId: true, payload: true },
    })
    expect(JSON.stringify(auditEvents)).not.toContain('player-a')
    expect(auditEvents).toContainEqual({
      actorId: expect.stringMatching(/^deleted-participant-/),
      payload: {
        data: {
          playerId: expect.stringMatching(/^deleted-participant-/),
          slot: 1,
        },
        formatVersion: 1,
      },
    })
    const persistedCommands = await prisma.tenderCommand.findMany({
      where: { tenderId },
      select: { fingerprint: true, receipt: true },
    })
    expect(JSON.stringify(persistedCommands)).not.toContain('player-a')
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

  test('replays one receipt when the same command reaches separate PostgreSQL pools concurrently', async () => {
    const secondPrisma = createPrisma(databaseUrl!)
    try {
      const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
      const secondModule = createTenderModule({ store: createPrismaTenderStore(secondPrisma) })
      const { tenderId } = await firstModule.createTender({
        players: [
          { id: 'player-a', tiePriority: 1 },
          { id: 'player-b', tiePriority: 2 },
        ],
      })
      const command = {
        actorId: 'player-a',
        commandId: 'concurrent-command-a-1',
        slot: 1,
        tenderId,
        type: 'request-access-slot' as const,
      }

      const receipts = await Promise.all(Array.from({ length: 20 }, (_, index) => (
        (index % 2 === 0 ? firstModule : secondModule).execute(command)
      )))

      expect(receipts).toEqual(Array.from({ length: 20 }, () => ({ tenderId, version: 1 })))
      expect(await prisma.tenderCommand.count({ where: { tenderId } })).toBe(1)
      expect(await prisma.tenderAuditEvent.count({ where: { tenderId } })).toBe(1)
      expect(await prisma.tender.findUniqueOrThrow({
        where: { id: tenderId },
        select: { version: true },
      })).toEqual({ version: 1 })
    } finally {
      await secondPrisma.$disconnect()
    }
  }, 15_000)

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

  test('restores private Model Analysis state without exposing it to another player', async () => {
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
    await firstModule.execute({ actorId: 'player-a', commandId: 'slot-a', slot: 3, tenderId, type: 'request-access-slot' })
    await firstModule.execute({ actorId: 'player-b', commandId: 'slot-b', slot: 4, tenderId, type: 'request-access-slot' })
    await firstModule.execute({ actorId: 'player-a', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 2, reconnaissance: 0, reserve: 2 }, commandId: 'power-a', tenderId, type: 'allocate-power' })
    await firstModule.execute({ actorId: 'player-b', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 1, reconnaissance: 0, reserve: 3 }, commandId: 'power-b', tenderId, type: 'allocate-power' })
    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'thesis-a-1',
      fieldType: 'inertial',
      polarity: 'positive',
      signalId: 'aster',
      tenderId,
      type: 'submit-thesis',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      corporateReviewActive: true,
      privateTheses: [{
        fieldTypeCorrect: true,
        polarityCorrect: false,
        signalId: 'aster',
      }],
      publicTheses: [],
    })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      corporateReviewActive: false,
      privateTheses: [],
      publicTheses: [],
    })
  })

  test('restores a private Final Scientific Model draft after a PostgreSQL restart', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z')
    const firstModule = createTenderModule({
      now: () => now,
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
      commandId: 'working-model-a',
      tenderId,
      type: 'update-working-model',
      workingModel: {
        signals: {
          aster: {
            hypothesis: { fieldType: 'inertial', polarity: 'negative' },
            possibleFieldTypes: ['phase'],
          },
        },
      },
    })
    let dueAt = now
    for (let round = 1; round <= 5; round += 1) {
      dueAt = new Date(dueAt.getTime() + 90_000)
      await firstModule.advanceDueTenders({ limit: 10, now: dueAt })
      dueAt = new Date(dueAt.getTime() + 90_000)
      await firstModule.advanceDueTenders({ limit: 10, now: dueAt })
    }
    await firstModule.execute({
      actorId: 'player-a',
      commandId: 'final-draft-a',
      scientificModelDraft: {
        signals: {
          aster: { fieldType: 'inertial', polarity: 'negative' },
          boreal: { fieldType: 'phase' },
        },
      },
      tenderId,
      type: 'update-scientific-model-draft',
    })

    const restartedModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-a' })).toMatchObject({
      finalScientificModelProgress: { completed: 0, total: 2 },
      privateFinalScientificModelDraft: {
        signals: {
          aster: { fieldType: 'inertial', polarity: 'negative' },
          boreal: { fieldType: 'phase' },
        },
      },
    })
    expect(await restartedModule.readTenderView({ tenderId, playerId: 'player-b' })).toMatchObject({
      privateFinalScientificModelDraft: { signals: {} },
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
          data: {
            accessSlots: { 'player-a': 1, 'player-b': 3, 'player-c': 2, 'player-d': 6 },
            budgetByPlayer: { 'player-a': 0, 'player-b': 2, 'player-c': 1, 'player-d': 3 },
            sampleCompensationByPlayer: { 'player-d': 'aster' },
          },
          formatVersion: 1,
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
