import { z } from 'zod'

export const gameContractVersionHeader = 'X-Anomaly-Contract-Version'
export const gameContractVersionQuery = 'contractVersion'
export const gameContractVersionSchema = z.enum(['1', '2']).default('1')
export type GameContractVersion = z.infer<typeof gameContractVersionSchema>

export const gameCapabilitiesSchema = z.object({
  newGameFormatWritesEnabled: z.boolean(),
}).strict()
