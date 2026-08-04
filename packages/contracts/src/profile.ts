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
export type TutorialProgress = z.infer<typeof tutorialProgressSchema>
