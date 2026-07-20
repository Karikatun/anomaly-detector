import { expect, test } from 'bun:test'

import { resolveAccessSlots } from './access-slots'

const players = [
  { id: 'player-a', tiePriority: 1 },
  { id: 'player-b', tiePriority: 2 },
  { id: 'player-c', tiePriority: 3 },
  { id: 'player-d', tiePriority: 4 },
]

test('moves a displaced Player from the last occupied slot to the closest earlier free slot', () => {
  expect(resolveAccessSlots(players, {
    'player-a': 4,
    'player-b': 5,
    'player-c': 6,
    'player-d': 6,
  })).toEqual({
    'player-a': 4,
    'player-b': 5,
    'player-c': 6,
    'player-d': 3,
  })
})

test('moves a displaced Player into the one free slot before an occupied last slot', () => {
  expect(resolveAccessSlots(players, {
    'player-a': 3,
    'player-b': 4,
    'player-c': 6,
    'player-d': 6,
  })).toEqual({
    'player-a': 3,
    'player-b': 4,
    'player-c': 6,
    'player-d': 5,
  })
})
