import { z } from 'zod'
import { powerAllocationSchema, privateMeasurementSchema, privateThesisSchema, publicContractSchema, scientificJournalEntrySchema, scientificModelDraftSchema, scientificModelSchema, signalIdSchema, workingModelSchema } from '@anomaly-detector/contracts'
import { additionalScenarioVersion, type AdditionalTutorialState } from './additional-scenario'

const step = z.enum(['intro', 'plan', 'access', 'power', 'laboratory', 'thesis', 'review-intro', 'review-power', 'review-thesis', 'review-result', 'contracts', 'contract-result', 'recovery-contracts', 'recovery-result', 'final-intro', 'final-contract', 'final-contract-result', 'final-model', 'complete'])
const signalList = z.array(signalIdSchema).max(6).refine((items) => items.length === new Set(items).size)
const checkpoint = z.object({
  round: z.number().int().min(1).max(5), budget: z.number().int().min(0).max(20), corporateTrust: z.number().int().min(0).max(10), rating: z.number().int().min(0).max(100),
  accessSlot: z.number().int().min(1).max(6).nullable(), allocation: powerAllocationSchema.nullable(), selectedContractId: z.string().min(1).max(128).nullable(),
  samples: signalList, journal: z.array(scientificJournalEntrySchema).max(12), usedEvidence: z.array(z.string().min(1).max(128)).max(12), certifications: signalList, certifiedSignals: signalList,
  privateTheses: z.array(privateThesisSchema).max(6), privateMeasurements: z.array(privateMeasurementSchema).max(6), corporateReviewActive: z.boolean(), workingModel: workingModelSchema,
  finalDraft: scientificModelDraftSchema.nullable(), finalSubmission: scientificModelSchema.nullable(), publicContracts: z.array(publicContractSchema).max(3), publicFinalContract: publicContractSchema,
}).strict()

export const additionalTutorialStateSchema: z.ZodType<AdditionalTutorialState> = checkpoint.extend({
  playerId: z.string().min(1).max(128), lessonId: z.literal('additional'), scenarioVersion: z.literal(additionalScenarioVersion), step,
  checkpointKind: z.enum(['main', 'review', 'recovery', 'late-final']), checkpointStep: step.nullable(), checkpointInitial: checkpoint.nullable(), mainCheckpoint: checkpoint.nullable(),
  reviewCompleted: z.boolean(), recoveryCompleted: z.boolean(), ordinaryAccepted: z.boolean(), recoveryInterruptionPending: z.boolean(), modelScore: z.number().int().min(0).max(21),
}).strict().refine((state) => state.step !== 'complete' || (
  state.reviewCompleted && state.recoveryCompleted && state.ordinaryAccepted && state.finalSubmission !== null && state.publicFinalContract.bidOutcome === 'awarded'
))
