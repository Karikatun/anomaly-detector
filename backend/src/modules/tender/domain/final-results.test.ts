import { expect, test } from 'bun:test'

import { createPlacementByPlayer, resolveWinnerPlayerIds } from './final-results'

const players = [
  { id: 'alpha', tiePriority: 1 },
  { id: 'beta', tiePriority: 2 },
  { id: 'gamma', tiePriority: 3 },
]

const createState = () => ({
  budgetByPlayer: { alpha: 1, beta: 3, gamma: 99 },
  certifiedSignalsByPlayer: {
    alpha: ['aster' as const],
    beta: ['aster' as const],
    gamma: ['aster' as const],
  },
  forfeitedAtByPlayer: { gamma: '2026-07-29T12:00:00.000Z' },
  players,
  publicTheses: [],
  ratingByPlayer: { alpha: 10, beta: 10, gamma: 100 },
  ruleset: 'tender-v2' as const,
})

test('resolves winners by rating, thesis count, then remaining budget and excludes forfeited players', () => {
  expect(resolveWinnerPlayerIds(createState())).toEqual(['beta'])
})

test('assigns shared places and ranks forfeited players after active players', () => {
  const state = createState()
  state.budgetByPlayer.alpha = 3

  expect(createPlacementByPlayer(state)).toEqual({ alpha: 1, beta: 1, gamma: 3 })
})
