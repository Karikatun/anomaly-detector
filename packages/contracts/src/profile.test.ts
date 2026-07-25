import { expect, test } from 'bun:test'

import { profileStatisticsSchema } from './profile'

test('profile statistics distinguish an empty history from zero performance', () => {
  expect(profileStatisticsSchema.parse({
    averagePlacement: null,
    averageRating: null,
    contractSuccessRate: null,
    matchesPlayed: 0,
    modelAccuracy: null,
    wins: 0,
    winRate: null,
  })).toEqual({
    averagePlacement: null,
    averageRating: null,
    contractSuccessRate: null,
    matchesPlayed: 0,
    modelAccuracy: null,
    wins: 0,
    winRate: null,
  })
})
