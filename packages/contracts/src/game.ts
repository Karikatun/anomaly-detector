import { z } from 'zod'

export const gameModeSchema = z.enum(['standard', 'simple'])
export const gameDescriptorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('standard'), rounds: z.literal(5), powerPerRound: z.literal(4), contracts: z.literal(true), scoring: z.literal('standard') }).strict(),
  z.object({ mode: z.literal('simple'), rounds: z.literal(3), powerPerRound: z.literal(4), contracts: z.literal(false), scoring: z.literal('properties-12') }).strict(),
])
export type GameMode = z.infer<typeof gameModeSchema>
export type GameDescriptor = z.infer<typeof gameDescriptorSchema>

export function gameDescriptor(mode: GameMode = 'standard'): GameDescriptor {
  return mode === 'simple'
    ? { mode, rounds: 3, powerPerRound: 4, contracts: false, scoring: 'properties-12' }
    : { mode, rounds: 5, powerPerRound: 4, contracts: true, scoring: 'standard' }
}
