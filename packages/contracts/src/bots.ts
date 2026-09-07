import { z } from 'zod'

export const botDifficultySchema = z.enum(['easy', 'hard'])
export const botParticipantSchema = z.object({
  difficulty: botDifficultySchema,
  strategyVersion: z.literal('bot-v1'),
}).strict()

export type BotDifficulty = z.infer<typeof botDifficultySchema>
