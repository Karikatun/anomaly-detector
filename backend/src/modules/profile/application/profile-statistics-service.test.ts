import { expect, test } from 'bun:test'

import { ProfileStatisticsService } from './profile-statistics-service'

test('uses authoritative simple placement and keeps its accuracy separate from standard ratings', async () => {
  const service = new ProfileStatisticsService({ completedTenderSummaryReader: { listCompletedMatches: async () => [
    { mode: 'simple', excludeFromPerformanceAverages: false, players: [
      { playerId: 'a', rating: 8, budget: 5, correctTheses: 0, placement: 1 },
      { playerId: 'b', rating: 8, budget: 5, correctTheses: 5, placement: 2 },
    ], playerResult: { correctModelProperties: 8, submittedContracts: 0, successfulContracts: 0 }, winnerPlayerIds: ['a'] },
    { excludeFromPerformanceAverages: false, players: [
      { playerId: 'a', rating: 21, budget: 2, correctTheses: 2 },
      { playerId: 'b', rating: 10, budget: 5, correctTheses: 0 },
    ], playerResult: { correctModelProperties: 12, submittedContracts: 1, successfulContracts: 1 }, winnerPlayerIds: ['a'] },
  ] } })
  expect(await service.read('a')).toMatchObject({ matchesPlayed: 1, averageRating: 21, modelAccuracy: 1 })
  const result = await service.readByMode('a')
  expect(result.standard.matchesPlayed).toBe(1)
  expect(result.simple).toEqual({ averagePlacement: 1, matchesPlayed: 1, modelAccuracy: 8 / 12, wins: 1, winRate: 1 })
})

test('aggregates completed match results with shared places and full shared wins', async () => {
  const service = new ProfileStatisticsService({
    completedTenderSummaryReader: {
      listCompletedMatches: async () => [
        {
          excludeFromPerformanceAverages: false,
          players: [
            { budget: 4, correctTheses: 3, playerId: 'leader', rating: 12 },
            { budget: 1, correctTheses: 2, playerId: 'player-a', rating: 10 },
            { budget: 1, correctTheses: 2, playerId: 'player-b', rating: 10 },
            { budget: 5, correctTheses: 0, playerId: 'last', rating: 5 },
          ],
          playerResult: {
            correctModelProperties: 9,
            submittedContracts: 2,
            successfulContracts: 1,
          },
          winnerPlayerIds: ['leader'],
        },
        {
          excludeFromPerformanceAverages: false,
          players: [
            { budget: 2, correctTheses: 3, playerId: 'player-a', rating: 15 },
            { budget: 2, correctTheses: 3, playerId: 'player-b', rating: 15 },
          ],
          playerResult: {
            correctModelProperties: 12,
            submittedContracts: 1,
            successfulContracts: 1,
          },
          winnerPlayerIds: ['player-a', 'player-b'],
        },
        {
          excludeFromPerformanceAverages: true,
          players: [
            { budget: 0, correctTheses: 0, playerId: 'player-a', rating: 0 },
            {
              budget: 20,
              correctTheses: 10,
              forfeitedAt: '2026-07-29T10:02:00.000Z',
              playerId: 'player-b',
              rating: 100,
            },
            {
              budget: 30,
              correctTheses: 12,
              forfeitedAt: '2026-07-29T10:01:00.000Z',
              playerId: 'leader',
              rating: 200,
            },
          ],
          playerResult: {
            correctModelProperties: 0,
            submittedContracts: 1,
            successfulContracts: 0,
          },
          winnerPlayerIds: ['player-a'],
        },
      ],
    },
  })

  expect(await service.read('player-a')).toEqual({
    averagePlacement: 4 / 3,
    averageRating: 12.5,
    contractSuccessRate: 0.5,
    matchesPlayed: 3,
    modelAccuracy: 21 / 24,
    wins: 2,
    winRate: 2 / 3,
  })
})

test('keeps early completion out of rating and model averages when it is the only match', async () => {
  const service = new ProfileStatisticsService({
    completedTenderSummaryReader: {
      listCompletedMatches: async () => [{
        excludeFromPerformanceAverages: true,
        players: [
          { budget: 0, correctTheses: 0, playerId: 'active', rating: 0 },
          {
            budget: 10,
            correctTheses: 4,
            forfeitedAt: '2026-07-29T10:00:00.000Z',
            playerId: 'forfeited',
            rating: 12,
          },
        ],
        playerResult: {
          correctModelProperties: 0,
          submittedContracts: 0,
          successfulContracts: 0,
        },
        winnerPlayerIds: ['active'],
      }],
    },
  })

  expect(await service.read('active')).toMatchObject({
    averagePlacement: 1,
    averageRating: null,
    matchesPlayed: 1,
    modelAccuracy: null,
    wins: 1,
  })
})
