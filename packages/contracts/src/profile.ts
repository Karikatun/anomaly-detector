import { z } from 'zod'

const nullableStatisticSchema = z.number().nonnegative().nullable()
const nullableRatioSchema = z.number().min(0).max(1).nullable()

export const profileStatisticsSchema = z.object({
  averagePlacement: nullableStatisticSchema,
  averageRating: nullableStatisticSchema,
  contractSuccessRate: nullableRatioSchema,
  matchesPlayed: z.number().int().nonnegative(),
  modelAccuracy: nullableRatioSchema,
  wins: z.number().int().nonnegative(),
  winRate: nullableRatioSchema,
}).strict()

export const tutorialProgressSchema = z.object({
  completedAt: z.string().datetime().nullable(),
}).strict()

export type ProfileStatistics = z.infer<typeof profileStatisticsSchema>

export const profileStatisticsByModeSchema = z.object({
  standard: profileStatisticsSchema,
  simple: profileStatisticsSchema.omit({ averageRating: true, contractSuccessRate: true }),
}).strict()

export type ProfileStatisticsByMode = z.infer<typeof profileStatisticsByModeSchema>
export type TutorialProgress = z.infer<typeof tutorialProgressSchema>

export const tutorialLessonIdSchema = z.enum(['base', 'additional'])
export const tutorialScenarioVersionSchema = z.enum(['base-simple-v1', 'additional-standard-v1'])
export const tutorialLessonCompletionSchema = z.object({
  origin: z.literal('scenario'),
  scenarioVersion: tutorialScenarioVersionSchema,
  completedAt: z.string().datetime(),
}).strict()

export const tutorialLessonsProgressSchema = z.object({
  schemaVersion: z.literal(1),
  base: z.object({
    legacyCredit: z.object({
      origin: z.literal('legacy'),
      completedAt: z.string().datetime().nullable(),
    }).strict().nullable(),
    completion: tutorialLessonCompletionSchema.extend({
      scenarioVersion: z.literal('base-simple-v1'),
    }).nullable(),
  }).strict(),
  additional: z.object({
    completion: tutorialLessonCompletionSchema.extend({
      scenarioVersion: z.literal('additional-standard-v1'),
    }).nullable(),
  }).strict(),
}).strict()

// Additional completion remains readable, but its write command belongs to #79.
export const tutorialProgressCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scenario-completed'),
    lessonId: z.literal('base'),
    scenarioVersion: z.literal('base-simple-v1'),
  }).strict(),
  z.object({ kind: z.literal('legacy-credit') }).strict(),
])

export type TutorialLessonId = z.infer<typeof tutorialLessonIdSchema>
export type TutorialLessonCompletion = z.infer<typeof tutorialLessonCompletionSchema>
export type TutorialLessonsProgress = z.infer<typeof tutorialLessonsProgressSchema>
export type TutorialProgressCommand = z.infer<typeof tutorialProgressCommandSchema>
