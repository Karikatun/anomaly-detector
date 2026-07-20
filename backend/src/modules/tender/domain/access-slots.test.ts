import { expect, test } from 'bun:test'

import { resolveAccessSlots } from './access-slots'

const teams = [
  { id: 'team-a', participantId: 'player-a', tiePriority: 1 },
  { id: 'team-b', participantId: 'player-b', tiePriority: 2 },
  { id: 'team-c', participantId: 'player-c', tiePriority: 3 },
  { id: 'team-d', participantId: 'player-d', tiePriority: 4 },
]

test('moves a displaced Team from the last occupied slot to the closest earlier free slot', () => {
  expect(resolveAccessSlots(teams, {
    'team-a': 4,
    'team-b': 5,
    'team-c': 6,
    'team-d': 6,
  })).toEqual({
    'team-a': 4,
    'team-b': 5,
    'team-c': 6,
    'team-d': 3,
  })
})

test('moves a displaced Team into the one free slot before an occupied last slot', () => {
  expect(resolveAccessSlots(teams, {
    'team-a': 3,
    'team-b': 4,
    'team-c': 6,
    'team-d': 6,
  })).toEqual({
    'team-a': 3,
    'team-b': 4,
    'team-c': 6,
    'team-d': 5,
  })
})
