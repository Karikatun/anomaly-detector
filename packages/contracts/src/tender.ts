import { z } from 'zod'

export const tenderIdSchema = z.string().min(1).max(128)
export const tenderResourceIdSchema = z.uuid()
export const playerIdSchema = z.string().min(1).max(128)
export const commandIdSchema = z.string().min(1).max(128)
export const contractIdSchema = z.string().min(1).max(128)
export const signalIdSchema = z.enum(['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'])
export const tenderRulesetSchema = z.enum(['tender-v1', 'tender-v2'])

export const tenderPlayerSchema = z.object({
  id: playerIdSchema,
  tiePriority: z.number().int().min(1).max(4),
  displayName: z.string().min(1).max(100).optional(),
}).strict()

export const createTenderSchema = z.object({
  players: z.array(tenderPlayerSchema).min(2).max(4),
  ruleset: tenderRulesetSchema.optional(),
}).strict()

export const requestAccessSlotCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('request-access-slot'),
  slot: z.number().int().min(1).max(6),
}).strict()

export const powerAllocationSchema = z.object({
  contracts: z.number().int().min(0).max(1),
  laboratory: z.number().int().min(0).max(2),
  modelAnalysis: z.number().int().min(0).max(2),
  reconnaissance: z.number().int().min(0).max(2),
  reserve: z.number().int().min(0).max(4).optional(),
}).strict().refine(
  (allocation) => Object.values(allocation).reduce((total, power) => total + (power ?? 0), 0) === 4,
  'Power allocation must contain exactly four units',
)

export const allocatePowerCommandSchema = z.object({
  allocation: powerAllocationSchema,
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('allocate-power'),
}).strict()

export const reconnaissanceTargetSchema = z.union([signalIdSchema, z.literal('unknown-sector')])

export const conductReconnaissanceCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  targets: z.array(reconnaissanceTargetSchema).min(1).max(2).refine(
    (targets) => new Set(targets.filter((target) => target !== 'unknown-sector')).size
      === targets.filter((target) => target !== 'unknown-sector').length,
    'Revealed Reconnaissance Signals must be distinct',
  ).optional(),
  signals: z.array(signalIdSchema).min(1).max(2).refine(
    (signals) => new Set(signals).size === signals.length,
    'Reconnaissance Signals must be distinct',
  ).optional(),
  type: z.literal('conduct-reconnaissance'),
}).strict().refine((command) => (command.targets?.length ?? command.signals?.length ?? 0) > 0, 'Reconnaissance requires targets')

export const laboratoryProtocolSchema = z.enum(['impulse', 'continuous'])
export const fieldTypeSchema = z.enum(['inertial', 'electromagnetic', 'phase'])
export const polaritySchema = z.enum(['positive', 'negative'])
export const publicResultSchema = z.enum(['attenuation', 'reflection', 'transmission_gain', 'unstable_collapse'])
export const submitThesisCommandSchema = z.object({ commandId: commandIdSchema, tenderId: tenderIdSchema, actorId: playerIdSchema, signalId: signalIdSchema, fieldType: fieldTypeSchema, polarity: polaritySchema, type: z.literal('submit-thesis') }).strict()
export const finishModelAnalysisCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('finish-model-analysis'),
}).strict()
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
export const legacyRunLaboratoryTestCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  sourceSignal: signalIdSchema,
  receiverSignal: signalIdSchema,
  protocol: laboratoryProtocolSchema,
  type: z.literal('run-laboratory-test'),
}).strict().refine((command) => command.sourceSignal !== command.receiverSignal, 'Laboratory Signals must differ')

export const laboratoryPairSchema = z.object({
  receiverSignal: signalIdSchema,
  sourceSignal: signalIdSchema,
}).strict().refine((pair) => pair.sourceSignal !== pair.receiverSignal, 'Laboratory Signals must differ')

export const laboratoryActionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('impulse'),
    pair: laboratoryPairSchema,
  }).strict(),
  z.object({
    mode: z.literal('deep'),
    pair: laboratoryPairSchema,
  }).strict(),
  z.object({
    mode: z.literal('broad'),
    pairs: z.tuple([laboratoryPairSchema, laboratoryPairSchema]).refine(
      ([first, second]) => (
        first.sourceSignal !== second.sourceSignal
        || first.receiverSignal !== second.receiverSignal
      ),
      'Broad Laboratory pairs must be distinct',
    ),
  }).strict(),
])

export const runLaboratoryTestCommandSchema = z.union([
  legacyRunLaboratoryTestCommandSchema,
  z.object({
    commandId: commandIdSchema,
    tenderId: tenderIdSchema,
    actorId: playerIdSchema,
    laboratory: laboratoryActionSchema,
    type: z.literal('run-laboratory-test'),
  }).strict(),
])

export const reserveContractCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  contractId: contractIdSchema,
  type: z.literal('reserve-contract'),
}).strict()

export const skipContractCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('skip-contract'),
}).strict()

export const contractKindSchema = z.enum(['light', 'complex', 'scientific', 'final'])
export const contractSignalRoleSchema = z.enum(['source', 'receiver'])

export const submitContractBidCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  contractId: contractIdSchema,
  evidenceTestIds: z.array(z.string().min(1).max(128)).max(2).optional(),
  researchCertificationSignal: signalIdSchema.optional(),
  // Accepted only to replay commands recorded before the Contract-evidence migration.
  // The Tender module intentionally ignores both fields.
  claimedPublicResult: publicResultSchema.optional(),
  requestedFunding: z.number().int().min(0).max(5).optional(),
  type: z.literal('submit-contract-bid'),
}).strict()

export const scientificModelSignalSchema = z.object({
  fieldType: fieldTypeSchema.optional(),
  polarity: polaritySchema.optional(),
}).strict().refine(
  (claim) => claim.fieldType !== undefined || claim.polarity !== undefined,
  'Scientific Model Signal must claim at least one property',
)
export const scientificModelSchema = z.object({
  signals: z.partialRecord(signalIdSchema, scientificModelSignalSchema),
}).strict().refine(
  (model) => Object.keys(model.signals).length > 0,
  'Scientific Model must claim at least one Signal property',
)
export const scientificModelDraftSchema = z.object({
  signals: z.partialRecord(signalIdSchema, scientificModelSignalSchema),
}).strict()
export const updateScientificModelDraftCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  scientificModelDraft: scientificModelDraftSchema,
  type: z.literal('update-scientific-model-draft'),
}).strict()
export const submitScientificModelCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  scientificModel: scientificModelSchema,
  type: z.literal('submit-scientific-model'),
}).strict()

export const leaveTenderCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('leave-tender'),
}).strict()

export const resumeTenderCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('resume-tender'),
}).strict()
export const forfeitTenderCommandSchema = z.object({
  commandId: commandIdSchema,
  tenderId: tenderIdSchema,
  actorId: playerIdSchema,
  type: z.literal('forfeit-tender'),
}).strict()

export const tenderCommandSchema = z.union([
  requestAccessSlotCommandSchema,
  allocatePowerCommandSchema,
  conductReconnaissanceCommandSchema,
  runLaboratoryTestCommandSchema,
  updateWorkingModelCommandSchema,
  submitThesisCommandSchema,
  finishModelAnalysisCommandSchema,
  reserveContractCommandSchema,
  skipContractCommandSchema,
  submitContractBidCommandSchema,
  updateScientificModelDraftCommandSchema,
  submitScientificModelCommandSchema,
  leaveTenderCommandSchema,
  resumeTenderCommandSchema,
  forfeitTenderCommandSchema,
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
  'final-scientific-model',
  'complete',
])

export const tenderPlayerViewSchema = z.object({
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(100).optional(),
  tiePriority: z.number().int().min(1).max(4).optional(),
  accessSlot: z.number().int().min(1).max(6).optional(),
  budget: z.number().int(),
  corporateTrust: z.number().int().min(0).optional(),
  contractPowerRestriction: z.number().int().min(0).max(1),
  finalScientificModelSubmitted: z.boolean().optional(),
  forfeited: z.boolean().optional(),
  modelAnalysisCompleted: z.boolean().optional(),
  powerAllocation: powerAllocationSchema.optional(),
  powerAllocationConfirmed: z.boolean().optional(),
  rating: z.number().int().min(0),
  requestedAccessSlot: z.number().int().min(1).max(6).optional(),
}).strict()

export const publicThesisSchema = z.object({
  correct: z.boolean(),
  fieldType: fieldTypeSchema,
  playerId: playerIdSchema,
  polarity: polaritySchema,
  signalId: signalIdSchema,
  verification: z.enum(['standard', 'extended']),
}).strict()

export const privateThesisSchema = z.object({
  fieldType: fieldTypeSchema,
  fieldTypeCorrect: z.boolean(),
  fullyCorrect: z.boolean(),
  id: z.string().min(1).max(128),
  polarity: polaritySchema,
  polarityCorrect: z.boolean(),
  round: z.number().int().min(1).max(5),
  signalId: signalIdSchema,
}).strict()

export const publicContractSchema = z.object({
  awardedToPlayerId: playerIdSchema.optional(),
  bidOutcome: z.enum(['awarded', 'failed']).optional(),
  contractId: contractIdSchema,
  eligibleForPlayer: z.boolean().optional(),
  kind: contractKindSchema.optional(),
  planning: z.object({
    eligible: z.boolean(),
    missingConditions: z.array(z.enum([
      'already_resolved',
      'corporate_trust',
      'evidence',
      'evidence_result',
      'evidence_role',
      'evidence_used',
      'final_round',
      'reserved',
    ])),
    requiredPower: z.literal(1),
    suitableEvidenceSelections: z.array(z.array(z.string().min(1).max(128)).min(1).max(2)),
    suitableEvidenceTestIds: z.array(z.string().min(1).max(128)),
    suitableResearchCertificationSignals: z.array(signalIdSchema),
  }).strict().optional(),
  ratingReward: z.number().int().min(0).optional(),
  requiredPublicResult: publicResultSchema,
  requiredSecondaryPublicResult: publicResultSchema.optional(),
  reservedByPlayerId: playerIdSchema.optional(),
  targetSignal: signalIdSchema.optional(),
  targetRole: contractSignalRoleSchema.optional(),
}).strict()

export const publicLaboratoryResultSchema = z.object({
  playerId: playerIdSchema,
  protocol: laboratoryProtocolSchema,
  publicResult: publicResultSchema,
  receiverSignal: signalIdSchema,
  sourceSignal: signalIdSchema,
}).strict()

export const scientificJournalEntrySchema = publicLaboratoryResultSchema.extend({
  testId: z.string().min(1).max(128),
}).strict()

export const privateMeasurementSchema = z.object({
  receiverSignal: signalIdSchema,
  sourceSignal: signalIdSchema,
  polarityRelation: z.enum(['same', 'different']),
}).strict()

export const anomalyConfigurationSchema = z.object({
  seed: z.string().min(1),
  signals: z.record(signalIdSchema, z.object({
    fieldType: fieldTypeSchema,
    polarity: polaritySchema,
  }).strict()),
}).strict()

export const ratingBreakdownSchema = z.object({
  completeModelBonus: z.number().int().min(0),
  contractPoints: z.number().int().min(0),
  correctPropertyPoints: z.number().int().min(0),
  correctSignalPoints: z.number().int().min(0),
  otherPoints: z.number().int(),
  thesisPoints: z.number().int().min(0),
  total: z.number().int().min(0),
}).strict()

export const finalScientificModelSignalAuditSchema = z.object({
  fieldType: fieldTypeSchema.optional(),
  fieldTypeCorrect: z.boolean().optional(),
  polarity: polaritySchema.optional(),
  polarityCorrect: z.boolean().optional(),
}).strict()

export const finalScientificModelAuditSchema = z.object({
  signals: z.partialRecord(signalIdSchema, finalScientificModelSignalAuditSchema),
  submitted: z.boolean(),
}).strict()

export const tenderAuditAccessSlotSchema = z.object({
  assignedSlot: z.number().int().min(1).max(6).optional(),
  playerId: playerIdSchema,
  requestedSlot: z.number().int().min(1).max(6).optional(),
  resolution: z.enum(['confirmed', 'timeout']),
}).strict()

export const tenderAuditPowerAllocationSchema = z.object({
  allocation: powerAllocationSchema,
  playerId: playerIdSchema,
  resolution: z.enum(['confirmed', 'timeout']),
}).strict()

export const tenderAuditReconnaissanceSchema = z.object({
  playerId: playerIdSchema,
  resolution: z.enum(['completed', 'skipped', 'timeout']),
  skipReason: z.enum(['all_samples_collected']).optional(),
  targets: z.array(reconnaissanceTargetSchema).max(2),
}).strict()

export const tenderAuditLaboratoryTestSchema = scientificJournalEntrySchema.extend({
  usedByContractId: contractIdSchema.optional(),
}).strict()

export const tenderAuditLaboratoryActionSchema = z.object({
  mode: z.enum(['impulse', 'deep', 'broad']),
  playerId: playerIdSchema,
  privateMeasurements: z.array(privateMeasurementSchema).max(1).optional(),
  resolution: z.enum(['completed', 'skipped', 'timeout']).default('completed'),
  skipReason: z.enum(['all_pairs_researched', 'insufficient_samples']).optional(),
  tests: z.array(tenderAuditLaboratoryTestSchema).max(2),
}).strict()

export const tenderAuditThesisSchema = privateThesisSchema.extend({
  playerId: playerIdSchema,
}).strict()

export const tenderAuditContractConditionsSchema = z.object({
  kind: contractKindSchema,
  ratingReward: z.number().int().min(0),
  requiredPublicResult: publicResultSchema,
  requiredSecondaryPublicResult: publicResultSchema.optional(),
  targetRole: contractSignalRoleSchema,
  targetSignal: signalIdSchema,
}).strict()

export const tenderAuditContractSchema = z.object({
  conditions: tenderAuditContractConditionsSchema.optional(),
  contractId: contractIdSchema.optional(),
  evidenceTestIds: z.array(z.string().min(1).max(128)).max(2),
  evidenceTests: z.array(scientificJournalEntrySchema).max(2).default([]),
  outcome: z.enum(['awarded', 'skipped', 'timeout_released']),
  playerId: playerIdSchema,
  ratingAward: z.number().int().min(0),
  researchCertificationSignal: signalIdSchema.optional(),
}).strict()

export const tenderAuditRatingChangeSchema = z.object({
  playerId: playerIdSchema,
  points: z.number().int(),
  source: z.enum(['contract', 'final_model', 'thesis', 'other']),
}).strict()

export const tenderAuditRoundSchema = z.object({
  accessSlots: z.array(tenderAuditAccessSlotSchema),
  contracts: z.array(tenderAuditContractSchema),
  laboratory: z.array(tenderAuditLaboratoryActionSchema),
  powerAllocations: z.array(tenderAuditPowerAllocationSchema),
  priorityPlayerIds: z.array(playerIdSchema).min(1).max(4),
  ratingChanges: z.array(tenderAuditRatingChangeSchema),
  reconnaissance: z.array(tenderAuditReconnaissanceSchema),
  round: z.number().int().min(1).max(5),
  theses: z.array(tenderAuditThesisSchema),
}).strict()

export const tenderAuditViewSchema = z.object({
  anomalyConfiguration: anomalyConfigurationSchema,
  completionReason: z.enum([
    'standard',
    'all_players_left',
    'last_active_player',
    'all_players_forfeited',
  ]),
  finalScientificModelsByPlayer: z.record(playerIdSchema, finalScientificModelAuditSchema),
  forfeitedAtByPlayer: z.record(playerIdSchema, z.string().datetime()),
  placementByPlayer: z.record(playerIdSchema, z.number().int().min(1)),
  privateThesesByPlayer: z.record(playerIdSchema, z.array(privateThesisSchema)),
  privateMeasurementsByPlayer: z.record(playerIdSchema, z.array(privateMeasurementSchema)),
  privateTelemetryByPlayer: z.record(playerIdSchema, z.array(privateMeasurementSchema)).optional(),
  publicLaboratoryResults: z.array(publicLaboratoryResultSchema),
  publicScientificJournal: z.array(scientificJournalEntrySchema).optional(),
  ratingBreakdownByPlayer: z.record(playerIdSchema, ratingBreakdownSchema),
  rounds: z.array(tenderAuditRoundSchema),
  ruleset: tenderRulesetSchema,
}).strict()

export const tenderViewSchema = z.object({
  activePlayerId: playerIdSchema.optional(),
  abandonmentDueAt: z.string().datetime().nullable().optional(),
  completionReason: z.enum([
    'all_players_left',
    'last_active_player',
    'all_players_forfeited',
  ]).optional(),
  corporateReviewActive: z.boolean().optional(),
  hasLeft: z.boolean().optional(),
  hasForfeited: z.boolean().optional(),
  knownSignals: z.array(signalIdSchema),
  publicContracts: z.array(publicContractSchema),
  publicFinalContract: publicContractSchema.optional(),
  publicLaboratoryResults: z.array(publicLaboratoryResultSchema),
  publicScientificJournal: z.array(scientificJournalEntrySchema).optional(),
  round: z.number().int().min(1).max(5),
  ruleset: tenderRulesetSchema.optional(),
  serverTime: z.string().datetime(),
  tenderId: tenderIdSchema,
  version: z.number().int().min(0),
  phase: tenderPhaseSchema,
  dueAt: z.string().datetime().nullable().optional(),
  players: z.array(tenderPlayerViewSchema),
  privateRawTelemetrySignals: z.array(signalIdSchema),
  privateSamples: z.array(signalIdSchema),
  privateMeasurements: z.array(privateMeasurementSchema),
  privateTheses: z.array(privateThesisSchema).optional(),
  privateFinalScientificModelDraft: scientificModelDraftSchema.optional(),
  privateFinalScientificModelSubmission: z.object({
    scientificModel: scientificModelSchema,
    submittedAt: z.string().datetime(),
  }).strict().optional(),
  privateAutomaticOperationalSkip: z.object({
    phase: z.enum(['laboratory', 'reconnaissance']),
    reason: z.enum(['all_pairs_researched', 'all_samples_collected', 'insufficient_samples']),
    round: z.number().int().min(1).max(5),
  }).strict().optional(),
  privateResearchCertifications: z.array(signalIdSchema).optional(),
  privateTelemetry: z.array(privateMeasurementSchema).optional(),
  privateUsedContractEvidenceTestIds: z.array(z.string().min(1)).optional(),
  privateWorkingModel: workingModelSchema,
  publicTheses: z.array(publicThesisSchema),
  modelAnalysisProgress: z.object({
    completed: z.number().int().min(0),
    total: z.number().int().min(0),
  }).strict().optional(),
  finalScientificModelProgress: z.object({
    completed: z.number().int().min(0),
    total: z.number().int().min(0),
  }).strict().optional(),
  sequentialPhaseProgress: z.object({
    completed: z.number().int().min(0),
    total: z.number().int().min(0),
  }).strict().optional(),
  audit: tenderAuditViewSchema.optional(),
  winnerPlayerIds: z.array(playerIdSchema).optional(),
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
export type SignalId = z.infer<typeof signalIdSchema>
export type FieldType = z.infer<typeof fieldTypeSchema>
export type Polarity = z.infer<typeof polaritySchema>
export type LaboratoryProtocol = z.infer<typeof laboratoryProtocolSchema>
export type LaboratoryAction = z.infer<typeof laboratoryActionSchema>
export type PowerAllocation = z.infer<typeof powerAllocationSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
export type PublicContract = z.infer<typeof publicContractSchema>
export type PublicLaboratoryResult = z.infer<typeof publicLaboratoryResultSchema>
export type ScientificJournalEntry = z.infer<typeof scientificJournalEntrySchema>
export type PublicThesis = z.infer<typeof publicThesisSchema>
export type PrivateThesis = z.infer<typeof privateThesisSchema>
export type TenderAuditRound = z.infer<typeof tenderAuditRoundSchema>
export type RatingBreakdown = z.infer<typeof ratingBreakdownSchema>
export type TenderAuditView = z.infer<typeof tenderAuditViewSchema>
export type WorkingModel = z.infer<typeof workingModelSchema>
export type ScientificModel = z.infer<typeof scientificModelSchema>
export type ScientificModelDraft = z.infer<typeof scientificModelDraftSchema>
export type TenderPhase = z.infer<typeof tenderPhaseSchema>
export type TenderRuleset = z.infer<typeof tenderRulesetSchema>
export type TenderView = z.infer<typeof tenderViewSchema>
export type TenderViewQuery = z.infer<typeof tenderViewQuerySchema>
export type AdvanceDueTendersInput = z.infer<typeof advanceDueTendersInputSchema>
export type AdvanceDueTendersResult = z.infer<typeof advanceDueTendersResultSchema>
