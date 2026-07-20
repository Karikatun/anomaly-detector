import { z } from 'zod'

export const tenderIdSchema = z.string().min(1).max(128)
export const playerIdSchema = z.string().min(1).max(128)
export const commandIdSchema = z.string().min(1).max(128)
export const contractIdSchema = z.string().min(1).max(128)
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

export const laboratoryProtocolSchema = z.enum(['impulse', 'continuous'])
export const fieldTypeSchema = z.enum(['inertial', 'electromagnetic', 'phase'])
export const polaritySchema = z.enum(['positive', 'negative'])
export const publicResultSchema = z.enum(['attenuation', 'reflection', 'transmission_gain', 'unstable_collapse'])
export const submitThesisCommandSchema = z.object({ commandId: commandIdSchema, tenderId: tenderIdSchema, actorId: playerIdSchema, signalId: signalIdSchema, fieldType: fieldTypeSchema, polarity: polaritySchema, type: z.literal('submit-thesis') }).strict()
const uniqueFieldTypes = (values: Array<z.infer<typeof fieldTypeSchema>>) => new Set(values).size === values.length
const uniquePolarities = (values: Array<z.infer<typeof polaritySchema>>) => new Set(values).size === values.length
export const workingModelSignalSchema = z.object({
  excludedFieldTypes: z.array(fieldTypeSchema).max(3).refine(uniqueFieldTypes, 'Working Model field type marks must be distinct').optional(),
  excludedPolarities: z.array(polaritySchema).max(2).refine(uniquePolarities, 'Working Model polarity marks must be distinct').optional(),
  hypothesis: z.object({
    fieldType: fieldTypeSchema.optional(),
    polarity: polaritySchema.optional(),
  }).strict().optional(),
  note: z.string().max(1000).optional(),
  possibleFieldTypes: z.array(fieldTypeSchema).max(3).refine(uniqueFieldTypes, 'Working Model field type marks must be distinct').optional(),
  possiblePolarities: z.array(polaritySchema).max(2).refine(uniquePolarities, 'Working Model polarity marks must be distinct').optional(),
}).strict()
export const workingModelSchema = z.object({
  signals: z.partialRecord(signalIdSchema, workingModelSignalSchema),
}).strict()
export const updateWorkingModelCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('update-working-model'),
  workingModel: workingModelSchema,
}).strict()
export const runLaboratoryTestCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  sourceSignal: signalIdSchema,
  receiverSignal: signalIdSchema,
  protocol: laboratoryProtocolSchema,
  type: z.literal('run-laboratory-test'),
}).strict().refine((command) => command.sourceSignal !== command.receiverSignal, 'Laboratory Signals must differ')

export const reserveContractCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  contractId: contractIdSchema,
  type: z.literal('reserve-contract'),
}).strict()

export const submitContractBidCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  contractId: contractIdSchema,
  claimedPublicResult: publicResultSchema,
  requestedFunding: z.number().int().min(0).max(10),
  type: z.literal('submit-contract-bid'),
}).strict()

export const tenderCommandSchema = z.discriminatedUnion('type', [
  requestAccessSlotCommandSchema,
  allocatePowerCommandSchema,
  conductReconnaissanceCommandSchema,
  runLaboratoryTestCommandSchema,
  updateWorkingModelCommandSchema,
  submitThesisCommandSchema,
  reserveContractCommandSchema,
  submitContractBidCommandSchema,
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
  budget: z.number().int().min(0),
  contractPowerRestriction: z.number().int().min(0).max(1),
  powerAllocation: powerAllocationSchema.optional(),
  rating: z.number().int().min(0),
  requestedAccessSlot: z.number().int().min(1).max(6).optional(),
}).strict()

export const publicThesisSchema = z.object({
  correct: z.boolean(),
  fieldType: fieldTypeSchema,
  playerId: playerIdSchema,
  polarity: polaritySchema,
  signalId: signalIdSchema,
}).strict()

export const publicContractSchema = z.object({
  awardedToPlayerId: playerIdSchema.optional(),
  bidOutcome: z.enum(['awarded', 'failed']).optional(),
  contractId: contractIdSchema,
  requiredPublicResult: publicResultSchema,
  reservedByPlayerId: playerIdSchema.optional(),
}).strict()

export const publicLaboratoryResultSchema = z.object({
  playerId: playerIdSchema,
  protocol: laboratoryProtocolSchema,
  publicResult: publicResultSchema,
  receiverSignal: signalIdSchema,
  sourceSignal: signalIdSchema,
}).strict()

export const privateMeasurementSchema = z.object({
  receiverSignal: signalIdSchema,
  sourceSignal: signalIdSchema,
  polarityRelation: z.enum(['same', 'different']),
}).strict()

export const tenderViewSchema = z.object({
  knownSignals: z.array(signalIdSchema),
  publicContracts: z.array(publicContractSchema),
  publicLaboratoryResults: z.array(publicLaboratoryResultSchema),
  tenderId: tenderIdSchema,
  version: z.number().int().min(0),
  phase: tenderPhaseSchema,
  players: z.array(tenderPlayerViewSchema),
  privateAnalyticalReports: z.number().int().min(0),
  privateRawTelemetrySignals: z.array(signalIdSchema),
  privateSamples: z.array(signalIdSchema),
  privateMeasurements: z.array(privateMeasurementSchema),
  privateWorkingModel: workingModelSchema,
  publicTheses: z.array(publicThesisSchema),
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
export type PublicContract = z.infer<typeof publicContractSchema>
export type PublicLaboratoryResult = z.infer<typeof publicLaboratoryResultSchema>
export type PublicThesis = z.infer<typeof publicThesisSchema>
export type WorkingModel = z.infer<typeof workingModelSchema>
export type TenderPhase = z.infer<typeof tenderPhaseSchema>
export type TenderView = z.infer<typeof tenderViewSchema>
export type TenderViewQuery = z.infer<typeof tenderViewQuerySchema>
export type AdvanceDueTendersInput = z.infer<typeof advanceDueTendersInputSchema>
export type AdvanceDueTendersResult = z.infer<typeof advanceDueTendersResultSchema>
