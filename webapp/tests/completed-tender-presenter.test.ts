import { expect, test } from 'bun:test'

import { presentCompletedTender } from '../src/features/tender/completed-tender-presenter'

const player = (playerId: string, displayName: string, rating: number) => ({
  budget: 2,
  contractPowerRestriction: 0,
  displayName,
  playerId,
  rating,
})

test('sorts shared placements, identifies the current player and formats non-zero rating entries', () => {
  const presentation = presentCompletedTender({
    audit: {
      completionReason: 'standard',
      placementByPlayer: { alpha: 2, beta: 1 },
      ratingBreakdownByPlayer: {
        alpha: {
          completeModelBonus: 0,
          contractPoints: 4,
          correctPropertyPoints: 0,
          correctSignalPoints: 0,
          otherPoints: -1,
          thesisPoints: 0,
          total: 3,
        },
      },
    },
    players: [player('alpha', 'Альфа', 3), player('beta', 'Бета', 8)],
    winnerPlayerIds: ['beta'],
  }, 'alpha')

  expect(presentation.rankedPlayers.map(({ playerId }) => playerId)).toEqual(['beta', 'alpha'])
  expect(presentation.currentPlayer?.playerId).toBe('alpha')
  expect(presentation.winnerNames).toEqual(['Бета'])
  expect(presentation.ratingEntries('alpha')).toEqual([
    { key: 'contractPoints', points: 4 },
    { key: 'otherPoints', points: -1 },
  ])
})
