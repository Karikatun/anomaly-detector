import { z } from 'zod'

export const botDifficultySchema = z.enum(['easy', 'hard'])
export const botParticipantSchema = z.object({
  difficulty: botDifficultySchema,
  strategyVersion: z.enum(['bot-v1', 'bot-v2']),
}).strict()

export type BotDifficulty = z.infer<typeof botDifficultySchema>
