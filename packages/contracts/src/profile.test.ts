import { expect, test } from 'bun:test'

import { profileStatisticsSchema, tutorialLessonsProgressSchema, tutorialProgressCommandSchema, tutorialProgressSchema } from './profile'

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

test('lesson progress preserves unknown legacy dates independently from actual completion', () => {
  const progress = {
    schemaVersion: 1,
    base: {
      legacyCredit: { origin: 'legacy', completedAt: null },
      completion: { origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: '2026-11-03T08:00:00.000Z' },
    },
    additional: { completion: null },
  } as const
  expect(tutorialLessonsProgressSchema.parse(progress)).toEqual(progress)
  expect(tutorialLessonsProgressSchema.safeParse({ ...progress, base: { ...progress.base, completion: { ...progress.base.completion, scenarioVersion: 'additional-standard-v1' } } }).success).toBe(false)
  expect(tutorialLessonsProgressSchema.safeParse({ ...progress, base: { ...progress.base, completion: { ...progress.base.completion, completedAt: null } } }).success).toBe(false)
})

test('lesson writes accept bounded base completion and legacy credit without actor or invented dates', () => {
  const complete = { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' } as const
  expect(tutorialProgressCommandSchema.parse(complete)).toEqual(complete)
  expect(tutorialProgressCommandSchema.parse({ kind: 'legacy-credit' })).toEqual({ kind: 'legacy-credit' })
  for (const command of [
    { ...complete, actorId: 'another-player' },
    { ...complete, completedAt: '2026-11-03T08:00:00.000Z' },
    { ...complete, scenarioVersion: 'additional-standard-v1' },
    { ...complete, lessonId: 'additional', scenarioVersion: 'additional-standard-v1' },
    { kind: 'legacy-credit', completedAt: '2026-11-03T08:00:00.000Z' },
    { kind: 'legacy-credit', lessonId: 'additional' },
  ]) expect(tutorialProgressCommandSchema.safeParse(command).success).toBe(false)
})
