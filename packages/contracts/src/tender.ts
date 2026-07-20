import { z } from 'zod'

export const tenderIdSchema = z.string().min(1).max(128)
export const participantIdSchema = z.string().min(1).max(128)
export const teamIdSchema = z.string().min(1).max(128)
export const commandIdSchema = z.string().min(1).max(128)

export const tenderTeamSchema = z.object({
  id: teamIdSchema,
  participantId: participantIdSchema,
  tiePriority: z.number().int().min(1).max(4),
}).strict()

export const createTenderSchema = z.object({
  teams: z.array(tenderTeamSchema).min(2).max(4),
}).strict()

export const requestAccessSlotCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: participantIdSchema,
  type: z.literal('request-access-slot'),
  slot: z.number().int().min(1).max(6),
}).strict()

export const tenderCommandSchema = z.discriminatedUnion('type', [requestAccessSlotCommandSchema])

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

export const tenderTeamViewSchema = z.object({
  teamId: teamIdSchema,
  accessSlot: z.number().int().min(1).max(6).optional(),
  requestedAccessSlot: z.number().int().min(1).max(6).optional(),
}).strict()

export const tenderViewSchema = z.object({
  tenderId: tenderIdSchema,
  version: z.number().int().min(0),
  phase: tenderPhaseSchema,
  teams: z.array(tenderTeamViewSchema),
}).strict()

export const tenderViewQuerySchema = z.object({
  tenderId: tenderIdSchema,
  participantId: participantIdSchema,
}).strict()

export const advanceDueTendersInputSchema = z.object({
  now: z.date(),
  limit: z.number().int().min(1).max(1000),
}).strict()

export const advanceDueTendersResultSchema = z.object({
  advancedTenderIds: z.array(tenderIdSchema),
}).strict()

export type TenderTeam = z.infer<typeof tenderTeamSchema>
export type CreateTender = z.infer<typeof createTenderSchema>
export type TenderCommand = z.infer<typeof tenderCommandSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
export type TenderPhase = z.infer<typeof tenderPhaseSchema>
export type TenderView = z.infer<typeof tenderViewSchema>
export type TenderViewQuery = z.infer<typeof tenderViewQuerySchema>
export type AdvanceDueTendersInput = z.infer<typeof advanceDueTendersInputSchema>
export type AdvanceDueTendersResult = z.infer<typeof advanceDueTendersResultSchema>
