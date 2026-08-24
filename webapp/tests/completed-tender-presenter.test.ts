import { expect, test } from 'bun:test'

import { presentCompletedTender, tenderPointUnit } from '../src/features/tender/completed-tender-presenter'

const player = (playerId: string, displayName: string, rating: number, corporateTrust = 0) => ({
  budget: 2,
  corporateTrust,
  contractPowerRestriction: 0,
  displayName,
  playerId,
  rating,
})

const privateThesis = (
  id: string,
  signalId: 'aster' | 'boreal' | 'cinder',
  round: number,
  fullyCorrect = true,
) => ({
  fieldType: 'inertial' as const,
  fieldTypeCorrect: fullyCorrect,
  fullyCorrect,
  id,
  polarity: 'positive' as const,
  polarityCorrect: true,
  round,
  signalId,
})

test('sorts shared placements, identifies the current player and formats non-zero rating entries', () => {
  const presentation = presentCompletedTender({
    audit: {
      completionReason: 'standard',
      placementByPlayer: { alpha: 2, beta: 1 },
      privateThesesByPlayer: {
        beta: [
          privateThesis('beta-thesis-1', 'aster', 1),
          privateThesis('beta-thesis-2', 'boreal', 2),
        ],
      },
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
        beta: {
          completeModelBonus: 0,
          contractPoints: 6,
          correctPropertyPoints: 0,
          correctSignalPoints: 0,
          otherPoints: 0,
          thesisPoints: 2,
          total: 8,
        },
      },
      ruleset: 'tender-v2',
    },
    players: [player('alpha', 'Альфа', 3, 1), player('beta', 'Бета', 8, 2)],
    publicTheses: [],
    winnerPlayerIds: ['beta'],
  }, 'alpha')

  expect(presentation.rankedPlayers.map(({ playerId }) => playerId)).toEqual(['beta', 'alpha'])
  expect(presentation.currentPlayer?.playerId).toBe('alpha')
  expect(presentation.currentPlayerIsWinner).toBeFalse()
  expect(presentation.currentPlacement).toBe(2)
  expect(presentation.currentRating).toBe(3)
  expect(presentation.winnerNames).toEqual(['Бета'])
  expect(presentation.ratingEntries('alpha')).toEqual([
    { key: 'contractPoints', points: 4 },
    { key: 'otherPoints', points: -1 },
  ])
  expect(presentation.standingFactors('beta')).toEqual({
    corporateTrust: 2,
    correctTheses: 2,
    rating: 8,
    remainingBudget: 2,
  })
})

test('identifies when the current player won without duplicating the winner summary', () => {
  const presentation = presentCompletedTender({
    audit: {
      completionReason: 'standard',
      placementByPlayer: { alpha: 1, beta: 2 },
      privateThesesByPlayer: {},
      ratingBreakdownByPlayer: {},
      ruleset: 'tender-v2',
    },
    players: [player('alpha', 'Альфа', 106), player('beta', 'Бета', 0)],
    publicTheses: [],
    winnerPlayerIds: ['alpha'],
  }, 'alpha')

  expect(presentation.currentPlayerIsWinner).toBeTrue()
  expect(presentation.currentPlacement).toBe(1)
  expect(presentation.currentRating).toBe(106)
})

test('derives v2 correct Theses from unique fully-correct audited Signals', () => {
  const presentation = presentCompletedTender({
    audit: {
      completionReason: 'standard',
      placementByPlayer: { alpha: 1 },
      privateThesesByPlayer: {
        alpha: [
          privateThesis('thesis-1', 'aster', 1),
          privateThesis('thesis-2', 'aster', 2),
          privateThesis('thesis-3', 'boreal', 3),
          privateThesis('thesis-4', 'cinder', 4, false),
        ],
      },
      ratingBreakdownByPlayer: {
        alpha: {
          completeModelBonus: 0,
          contractPoints: 0,
          correctPropertyPoints: 0,
          correctSignalPoints: 0,
          otherPoints: 2,
          thesisPoints: 0,
          total: 2,
        },
      },
      ruleset: 'tender-v2',
    },
    players: [player('alpha', 'Альфа', 2)],
    publicTheses: [],
    winnerPlayerIds: ['alpha'],
  }, 'alpha')

  expect(presentation.standingFactors('alpha').correctTheses).toBe(2)
})

test('derives v1 correct Theses from the public Thesis history', () => {
  const presentation = presentCompletedTender({
    audit: {
      completionReason: 'standard',
      placementByPlayer: { alpha: 1, beta: 2 },
      privateThesesByPlayer: {},
      ratingBreakdownByPlayer: {
        alpha: {
          completeModelBonus: 0,
          contractPoints: 0,
          correctPropertyPoints: 0,
          correctSignalPoints: 0,
          otherPoints: 2,
          thesisPoints: 0,
          total: 2,
        },
      },
      ruleset: 'tender-v1',
    },
    players: [player('alpha', 'Альфа', 2), player('beta', 'Бета', 1)],
    publicTheses: [
      {
        correct: true,
        fieldType: 'inertial',
        playerId: 'alpha',
        polarity: 'positive',
        signalId: 'aster',
        verification: 'standard',
      },
      {
        correct: true,
        fieldType: 'phase',
        playerId: 'alpha',
        polarity: 'negative',
        signalId: 'boreal',
        verification: 'extended',
      },
      {
        correct: false,
        fieldType: 'electromagnetic',
        playerId: 'alpha',
        polarity: 'negative',
        signalId: 'cinder',
        verification: 'standard',
      },
      {
        correct: true,
        fieldType: 'phase',
        playerId: 'beta',
        polarity: 'positive',
        signalId: 'delta',
        verification: 'standard',
      },
    ],
    winnerPlayerIds: ['alpha'],
  }, 'alpha')

  expect(presentation.standingFactors('alpha').correctTheses).toBe(2)
})

test('selects Russian plural units for zero, large and edge-case point totals', () => {
  expect([0, 1, 2, 5, 21, 102, 111].map(tenderPointUnit)).toEqual([
    'many',
    'one',
    'few',
    'many',
    'one',
    'few',
    'many',
  ])
})
