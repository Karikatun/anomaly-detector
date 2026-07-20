import { z } from 'zod'

export const tenderIdSchema = z.string().min(1).max(128)
export const playerIdSchema = z.string().min(1).max(128)
export const commandIdSchema = z.string().min(1).max(128)
export const signalIdSchema = z.enum(['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'])

export const tenderPlayerSchema = z.object({
  id: playerIdSchema,
  tiePriority: z.number().int().min(1).max(4),
}).strict()

export const createTenderSchema = z.object({
  players: z.array(tenderPlayerSchema).min(2).max(4),
}).strict()

export const requestAccessSlotCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('request-access-slot'),
  slot: z.number().int().min(1).max(6),
}).strict()

export const powerAllocationSchema = z.object({
  contracts: z.number().int().min(0).max(2),
  laboratory: z.number().int().min(0).max(2),
  modelAnalysis: z.number().int().min(0).max(2),
  reconnaissance: z.number().int().min(0).max(2),
}).strict().refine(
  (allocation) => Object.values(allocation).reduce((total, power) => total + power, 0) === 4,
  'Power allocation must contain exactly four units',
)

export const allocatePowerCommandSchema = z.object({
  allocation: powerAllocationSchema,
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('allocate-power'),
}).strict()

export const conductReconnaissanceCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  signals: z.array(signalIdSchema).min(1).max(2).refine(
    (signals) => new Set(signals).size === signals.length,
    'Reconnaissance Signals must be distinct',
  ),
  type: z.literal('conduct-reconnaissance'),
}).strict()

export const tenderCommandSchema = z.discriminatedUnion('type', [
  requestAccessSlotCommandSchema,
  allocatePowerCommandSchema,
  conductReconnaissanceCommandSchema,
])

export const commandReceiptSchema = z.object({
  tenderId: tenderIdSchema,
  version: z.number().int().min(1),
}).strict()

export const tenderPhaseSchema = z.enum([
  'access-slot-selection',
  'power-allocation',
  'reconnaissance',
  'laboratory',
  'model-analysis',
  'contracts',
  'complete',
])

export const tenderPlayerViewSchema = z.object({
  playerId: playerIdSchema,
  accessSlot: z.number().int().min(1).max(6).optional(),
  powerAllocation: powerAllocationSchema.optional(),
  requestedAccessSlot: z.number().int().min(1).max(6).optional(),
}).strict()

export const tenderViewSchema = z.object({
  knownSignals: z.array(signalIdSchema),
  tenderId: tenderIdSchema,
  version: z.number().int().min(0),
  phase: tenderPhaseSchema,
  players: z.array(tenderPlayerViewSchema),
  privateRawTelemetrySignals: z.array(signalIdSchema),
  privateSamples: z.array(signalIdSchema),
}).strict()

export const tenderViewQuerySchema = z.object({
  tenderId: tenderIdSchema,
  playerId: playerIdSchema,
}).strict()

export const advanceDueTendersInputSchema = z.object({
  now: z.date(),
  limit: z.number().int().min(1).max(1000),
}).strict()

export const advanceDueTendersResultSchema = z.object({
  advancedTenderIds: z.array(tenderIdSchema),
}).strict()

export type TenderPlayer = z.infer<typeof tenderPlayerSchema>
export type CreateTender = z.infer<typeof createTenderSchema>
export type TenderCommand = z.infer<typeof tenderCommandSchema>
export type PowerAllocation = z.infer<typeof powerAllocationSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
export type TenderPhase = z.infer<typeof tenderPhaseSchema>
export type TenderView = z.infer<typeof tenderViewSchema>
export type TenderViewQuery = z.infer<typeof tenderViewQuerySchema>
export type AdvanceDueTendersInput = z.infer<typeof advanceDueTendersInputSchema>
export type AdvanceDueTendersResult = z.infer<typeof advanceDueTendersResultSchema>
