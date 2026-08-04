import { expect, test } from 'bun:test'

import { profileStatisticsSchema, tutorialProgressSchema } from './profile'

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

test('tutorial progress exposes only the optional account completion marker', () => {
  expect(tutorialProgressSchema.parse({ completedAt: null })).toEqual({ completedAt: null })
  expect(tutorialProgressSchema.parse({ completedAt: '2026-08-04T12:00:00.000Z' })).toEqual({
    completedAt: '2026-08-04T12:00:00.000Z',
  })
  expect(() => tutorialProgressSchema.parse({ completedAt: null, currentStep: 'access-slot' })).toThrow()
})
