import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createTenderModule } from './index'
import { createPrismaTenderStore } from './infrastructure/prisma-tender-store'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Tender PostgreSQL integration', () => {
  const prisma = createPrisma(databaseUrl!)

  beforeEach(async () => {
    await prisma.tender.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('restores a participant view through a new PostgreSQL store adapter', async () => {
    const firstModule = createTenderModule({
      seedGenerator: () => 'seed-1',
      store: createPrismaTenderStore(prisma),
    })
    const { tenderId } = await firstModule.createTender({
      teams: [
        { id: 'team-a', participantId: 'player-a', tiePriority: 1 },
        { id: 'team-b', participantId: 'player-b', tiePriority: 2 },
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

    expect(await restartedModule.readTenderView({ tenderId, participantId: 'player-a' })).toEqual({
      tenderId,
      version: 1,
      phase: 'access-slot-selection',
      teams: [
        { teamId: 'team-a', requestedAccessSlot: 1 },
      { teamId: 'team-b' },
    ],
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
        payload: { slot: 1, teamId: 'team-a' },
        sequence: 1,
      },
    ])
  })

  test('replays a persisted command receipt through a new PostgreSQL store adapter', async () => {
    const firstModule = createTenderModule({ store: createPrismaTenderStore(prisma) })
    const { tenderId } = await firstModule.createTender({
      teams: [
        { id: 'team-a', participantId: 'player-a', tiePriority: 1 },
        { id: 'team-b', participantId: 'player-b', tiePriority: 2 },
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
})
