import { expect, test } from 'bun:test'

import { createTenderModule } from './index'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'
import {
  createCompletedTenderSummaryReader,
  createTenderLifecycleReader,
} from './application/tender-readers'

test('projects completed match summaries without exposing stored Tender state', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({
    now: () => new Date('2026-07-29T10:00:00.000Z'),
    store,
  })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  await tender.execute({
    actorId: 'player-a',
    commandId: 'forfeit-a',
    tenderId,
    type: 'forfeit-tender',
  })

  await expect(createCompletedTenderSummaryReader(store).listCompletedForPlayer('player-a'))
    .resolves.toEqual([{
      excludeFromPerformanceAverages: true,
      players: [
        {
          budget: 2,
          correctTheses: 0,
          forfeitedAt: '2026-07-29T10:00:00.000Z',
          playerId: 'player-a',
          rating: 0,
        },
        {
          budget: 2,
          correctTheses: 0,
          playerId: 'player-b',
          rating: 0,
        },
      ],
      playerResult: {
        correctModelProperties: 0,
        submittedContracts: 0,
        successfulContracts: 0,
      },
      winnerPlayerIds: ['player-b'],
    }])
})

test('projects player-specific Tender lifecycle without leaking its persistence model', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  await tender.execute({
    actorId: 'player-a',
    commandId: 'forfeit-a',
    tenderId,
    type: 'forfeit-tender',
  })

  const reader = createTenderLifecycleReader(store)
  await expect(reader.readLifecycle({ playerId: 'player-a', tenderId })).resolves.toEqual({
    completionReason: 'last_active_player',
    forfeited: true,
    phase: 'complete',
    ruleset: 'tender-v2',
  })
  await expect(reader.readLifecycle({ playerId: 'player-b', tenderId })).resolves.toEqual({
    completionReason: 'last_active_player',
    forfeited: false,
    phase: 'complete',
    ruleset: 'tender-v2',
  })
})

test('surfaces an incompatible completed Tender instead of silently omitting it', async () => {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store })
  const { tenderId } = await tender.createTender({
    players: [
      { id: 'player-a', tiePriority: 1 },
      { id: 'player-b', tiePriority: 2 },
    ],
  })
  await tender.execute({
    actorId: 'player-a',
    commandId: 'forfeit-a',
    tenderId,
    type: 'forfeit-tender',
  })
  const completed = await store.read(tenderId)
  if (!completed) throw new Error('Expected completed Tender')
  await store.commit({
    auditEvents: [],
    expectedVersion: completed.version,
    nextTender: {
      ...completed,
      budgetByPlayer: {},
      version: completed.version + 1,
    },
    tenderId,
  })

  await expect(createCompletedTenderSummaryReader(store).listCompletedForPlayer('player-a'))
    .rejects.toMatchObject({ name: 'TenderSummaryProjectionError' })
})
