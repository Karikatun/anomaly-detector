import { expect, test } from 'bun:test'

import { ProfileStatisticsService } from './profile-statistics-service'

test('aggregates completed match results with shared places and full shared wins', async () => {
  const service = new ProfileStatisticsService({
    repository: {
      listCompletedMatches: async () => [
        {
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
      ],
    },
  })

  expect(await service.read('player-a')).toEqual({
    averagePlacement: 1.5,
    averageRating: 12.5,
    contractSuccessRate: 2 / 3,
    matchesPlayed: 2,
    modelAccuracy: 21 / 24,
    wins: 1,
    winRate: 0.5,
  })
})
