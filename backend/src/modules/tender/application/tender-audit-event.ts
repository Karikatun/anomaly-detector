import {
  commandIdSchema,
  contractIdSchema,
  laboratoryProtocolSchema,
  playerIdSchema,
  powerAllocationSchema,
  publicResultSchema,
  reconnaissanceTargetSchema,
  scientificModelSchema,
  signalIdSchema,
  tenderPhaseSchema,
} from '@anomaly-detector/contracts'
import { z } from 'zod'

const auditEventMetadata = {
  actorId: playerIdSchema.optional(),
  commandId: commandIdSchema.optional(),
}

const playerIdListSchema = z.array(playerIdSchema).max(4)
const playerIntegerRecordSchema = z.record(playerIdSchema, z.number().int())
const accessSlotRecordSchema = z.record(playerIdSchema, z.number().int().min(1).max(6))
const signalByPlayerSchema = z.record(playerIdSchema, signalIdSchema)

const eventSchema = <Kind extends string, Payload extends z.ZodType>(
  kind: Kind,
  payload: Payload,
) => z.object({
  ...auditEventMetadata,
  kind: z.literal(kind),
  payload,
}).strict()

export const tenderAuditEventSchema = z.discriminatedUnion('kind', [
  eventSchema('access_slot_requested', z.object({
    playerId: playerIdSchema,
    slot: z.number().int().min(1).max(6),
  }).strict()),
  eventSchema('access_slots_resolved', z.object({
    accessSlots: accessSlotRecordSchema,
    budgetByPlayer: playerIntegerRecordSchema,
    sampleCompensationByPlayer: signalByPlayerSchema,
  }).strict()),
  eventSchema('access_slot_timeout_resolved', z.object({
    accessSlots: accessSlotRecordSchema,
    budgetByPlayer: playerIntegerRecordSchema,
    sampleCompensationByPlayer: signalByPlayerSchema,
    timedOutPlayerIds: playerIdListSchema,
  }).strict()),
  eventSchema('contract_bid_assessed', z.object({
    awarded: z.boolean(),
    awardedToPlayerId: playerIdSchema.optional(),
    contractId: contractIdSchema,
    corporateTrustByPlayer: playerIntegerRecordSchema,
    evidenceTestIds: z.array(z.string().min(1).max(128)).max(2),
    playerId: playerIdSchema,
    ratingAward: z.number().int().min(0),
    ratingByPlayer: playerIntegerRecordSchema,
    researchCertificationSignal: signalIdSchema.optional(),
  }).strict()),
  eventSchema('contract_reserved', z.object({
    contractId: contractIdSchema,
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('contract_reservation_timeout_released', z.object({
    contractId: contractIdSchema,
    phase: z.literal('contracts'),
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('contract_skipped_no_eligible_contract', z.object({
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('final_scientific_model_timeout_resolved', z.object({
    timedOutPlayerIds: playerIdListSchema,
  }).strict()),
  eventSchema('laboratory_test_completed', z.object({
    mode: z.enum(['broad', 'deep', 'impulse']),
    playerId: playerIdSchema,
    protocol: laboratoryProtocolSchema,
    results: z.array(z.object({
      publicResult: publicResultSchema,
      receiverSignal: signalIdSchema,
      sourceSignal: signalIdSchema,
    }).strict()).min(1).max(2),
  }).strict()),
  eventSchema('model_analysis_finished_early', z.object({
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('model_analysis_timeout_resolved', z.object({
    timedOutPlayerIds: playerIdListSchema,
  }).strict()),
  eventSchema('operational_action_auto_skipped', z.discriminatedUnion('phase', [
    z.object({
      phase: z.literal('laboratory'),
      playerId: playerIdSchema,
      reason: z.enum(['all_pairs_researched', 'insufficient_samples']),
    }).strict(),
    z.object({
      phase: z.literal('reconnaissance'),
      playerId: playerIdSchema,
      reason: z.literal('all_samples_collected'),
    }).strict(),
  ])),
  eventSchema('operational_action_timeout_resolved', z.object({
    phase: tenderPhaseSchema,
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('player_forfeited_tender', z.object({
    forfeitedAt: z.string().datetime(),
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('player_left_tender', z.object({
    abandonmentDueAt: z.string().datetime().optional(),
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('player_resumed_tender', z.object({
    abandonmentDueAt: z.string().datetime().optional(),
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('power_allocated', z.object({
    allocation: powerAllocationSchema,
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('power_allocation_timeout_resolved', z.object({
    timedOutPlayerIds: playerIdListSchema,
  }).strict()),
  eventSchema('private_thesis_checked', z.object({
    fieldTypeCorrect: z.boolean(),
    fullyCorrect: z.boolean(),
    playerId: playerIdSchema,
    polarityCorrect: z.boolean(),
    ratingAward: z.number().int().min(0),
    signalId: signalIdSchema,
    thesisId: z.string().min(1).max(128),
  }).strict()),
  eventSchema('reconnaissance_completed', z.object({
    acquiredSignals: z.array(signalIdSchema).max(2),
    playerId: playerIdSchema,
    targets: z.array(reconnaissanceTargetSchema).max(2),
  }).strict()),
  eventSchema('scientific_model_draft_updated', z.object({
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('scientific_model_scored', z.object({
    completeModelBonus: z.number().int().min(0),
    correctProperties: z.number().int().min(0),
    correctSignals: z.number().int().min(0),
    isCompleteModel: z.boolean(),
    playerId: playerIdSchema,
    ratingAward: z.number().int().min(0),
    scientificModel: scientificModelSchema,
  }).strict()),
  eventSchema('tender_abandoned', z.object({
    completionReason: z.literal('all_players_left'),
    playerIds: playerIdListSchema,
  }).strict()),
  eventSchema('tender_completed_early', z.object({
    completionReason: z.enum(['all_players_forfeited', 'last_active_player']),
    winnerPlayerIds: playerIdListSchema,
  }).strict()),
  eventSchema('thesis_checked', z.object({
    correct: z.boolean(),
    playerId: playerIdSchema,
    signalId: signalIdSchema,
  }).strict()),
  eventSchema('thesis_skipped_corporate_review', z.object({
    playerId: playerIdSchema,
  }).strict()),
  eventSchema('working_model_updated', z.object({
    playerId: playerIdSchema,
  }).strict()),
])

export const tenderAuditEventKinds = tenderAuditEventSchema.options.map(
  (schema) => schema.shape.kind.value,
) as [z.infer<typeof tenderAuditEventSchema>['kind'], ...z.infer<typeof tenderAuditEventSchema>['kind'][]]

const legacyTenderAuditEventSchema = z.object({
  ...auditEventMetadata,
  kind: z.enum(tenderAuditEventKinds),
  payload: z.record(z.string(), z.unknown()),
  sequence: z.number().int().min(1),
}).strict()

const persistedEnvelopeSchema = z.object({
  data: z.unknown(),
  formatVersion: z.literal(1),
}).strict()

export type PendingTenderAuditEvent = z.infer<typeof tenderAuditEventSchema>
export type TenderAuditEventKind = PendingTenderAuditEvent['kind']

export type StoredTenderAuditEvent =
  | (PendingTenderAuditEvent & { formatVersion: 1; sequence: number })
  | (z.infer<typeof legacyTenderAuditEventSchema> & { formatVersion: 0 })

export type TenderAuditEventDecodeErrorKind =
  | 'current_corruption'
  | 'historical_incompatible'

export class TenderAuditEventDecodeError extends Error {
  constructor(
    message: string,
    public readonly kind: TenderAuditEventDecodeErrorKind,
  ) {
    super(message)
    this.name = 'TenderAuditEventDecodeError'
  }
}

export function encodeTenderAuditEventPayload(event: PendingTenderAuditEvent) {
  const parsed = tenderAuditEventSchema.safeParse(event)
  if (!parsed.success) {
    throw new TenderAuditEventDecodeError(
      `Invalid Tender audit event ${eventKind(event)}`,
      'current_corruption',
    )
  }
  return {
    data: parsed.data.payload,
    formatVersion: 1 as const,
  }
}

export function decodeTenderAuditEvent(input: {
  actorId?: string | null
  commandId?: string | null
  kind: string
  payload: unknown
  sequence: number
}): StoredTenderAuditEvent {
  const metadata = {
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.commandId ? { commandId: input.commandId } : {}),
    kind: input.kind,
  }

  if (isRecord(input.payload) && 'formatVersion' in input.payload) {
    if (input.payload.formatVersion !== 1) {
      throw new TenderAuditEventDecodeError(
        `Unsupported Tender audit event format version ${String(input.payload.formatVersion)}`,
        'historical_incompatible',
      )
    }
    const envelope = persistedEnvelopeSchema.safeParse(input.payload)
    if (!envelope.success) throw invalidPersistedEvent(input, 'current_corruption')
    const event = tenderAuditEventSchema.safeParse({
      ...metadata,
      payload: envelope.data.data,
    })
    if (!event.success) throw invalidPersistedEvent(input, 'current_corruption')
    return { ...event.data, formatVersion: 1, sequence: input.sequence }
  }

  const legacyEvent = legacyTenderAuditEventSchema.safeParse({
    ...metadata,
    payload: input.payload,
    sequence: input.sequence,
  })
  if (!legacyEvent.success) throw invalidPersistedEvent(input, 'historical_incompatible')
  return { ...legacyEvent.data, formatVersion: 0 }
}

function invalidPersistedEvent(
  input: { kind: string; sequence: number },
  kind: TenderAuditEventDecodeErrorKind,
) {
  return new TenderAuditEventDecodeError(
    `Invalid persisted Tender audit event ${input.kind} at sequence ${input.sequence}`,
    kind,
  )
}

function eventKind(event: unknown) {
  return isRecord(event) && typeof event.kind === 'string' ? event.kind : '<unknown>'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
