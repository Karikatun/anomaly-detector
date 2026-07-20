import { expect, test } from 'bun:test'

import { createTenderModule } from './index'

test('records an Access Slot command once and exposes it only to its participant', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
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

  expect(await tender.execute(command)).toEqual({ tenderId, version: 1 })
  expect(await tender.execute(command)).toEqual({ tenderId, version: 1 })
  expect(await tender.readTenderView({ tenderId, participantId: 'player-a' })).toEqual({
    tenderId,
    version: 1,
    phase: 'access-slot-selection',
    teams: [
      { teamId: 'team-a', requestedAccessSlot: 1 },
      { teamId: 'team-b' },
    ],
  })
})

test('does not return a Tender view to a non-participant', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    teams: [
      { id: 'team-a', participantId: 'player-a', tiePriority: 1 },
      { id: 'team-b', participantId: 'player-b', tiePriority: 2 },
    ],
  })

  await expect(tender.readTenderView({ tenderId, participantId: 'player-c' })).rejects.toMatchObject({
    kind: 'participant_not_in_tender',
  })
})

test('identifies an unknown Tender with a stable failure kind', async () => {
  const tender = createTenderModule()

  await expect(tender.readTenderView({ tenderId: 'missing-tender', participantId: 'player-a' })).rejects.toMatchObject({
    kind: 'tender_not_found',
  })
})

test('rejects a commandId reused for a different Access Slot command', async () => {
  const tender = createTenderModule()
  const { tenderId } = await tender.createTender({
    teams: [
      { id: 'team-a', participantId: 'player-a', tiePriority: 1 },
      { id: 'team-b', participantId: 'player-b', tiePriority: 2 },
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
