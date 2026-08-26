import type {
  PowerAllocation,
  TenderAuditRound,
} from '@anomaly-detector/contracts'
import {
  contractIdSchema,
  playerIdSchema,
  publicResultSchema,
  signalIdSchema,
} from '@anomaly-detector/contracts'
import { z } from 'zod'
import { rotateTiePriority } from '../domain/access-slots'
import {
  finalContractId,
  isContractEvidenceSelectionEligible,
} from '../domain/contract-eligibility'
import { createRoundContracts } from '../domain/contracts'
import {
  tenderAuditEventSchema,
  TenderAuditEventDecodeError,
  type TenderAuditEventKind,
} from './tender-audit-event'
import type { StoredTender, StoredTenderAuditEvent } from './tender-store'

const timeoutAllocation: PowerAllocation = {
  contracts: 0,
  laboratory: 0,
  modelAnalysis: 0,
  reconnaissance: 0,
  reserve: 4,
}

const emptyRound = (tender: StoredTender, round: number): TenderAuditRound => ({
  accessSlots: [],
  contracts: [],
  laboratory: [],
  powerAllocations: [],
  priorityPlayerIds: rotateTiePriority(tender.players, round)
    .sort((left, right) => left.tiePriority - right.tiePriority)
    .map((player) => player.id),
  ratingChanges: [],
  reconnaissance: [],
  round,
  theses: [],
})

const stringValue = (value: unknown) => typeof value === 'string' ? value : undefined
const integerValue = (value: unknown) => Number.isInteger(value) ? value as number : undefined
const stringArray = (value: unknown) => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : []
const payloadValue = (payload: object, key: string): unknown =>
  (payload as Record<string, unknown>)[key]

const accessSlotRecordSchema = z.record(playerIdSchema, z.number().int().min(1).max(6))
const playerIdListSchema = z.array(playerIdSchema).max(4)

const historicalParticipantAuditVariantSchema = z.discriminatedUnion('kind', [
  // Early access resolution events did not persist the resulting budget/sample snapshots.
  z.object({
    kind: z.literal('access_slots_resolved'),
    payload: z.object({ accessSlots: accessSlotRecordSchema }).passthrough(),
  }).passthrough(),
  z.object({
    kind: z.literal('access_slot_timeout_resolved'),
    payload: z.object({
      accessSlots: accessSlotRecordSchema,
      timedOutPlayerIds: playerIdListSchema,
    }).passthrough(),
  }).passthrough(),
  // Participant audit expansion predates the state snapshots added to Contract events.
  z.object({
    kind: z.literal('contract_bid_assessed'),
    payload: z.object({
      awarded: z.boolean(),
      contractId: contractIdSchema,
      evidenceTestIds: z.array(z.string().min(1).max(128)).max(2),
      playerId: playerIdSchema,
      ratingAward: z.number().int().min(0),
    }).passthrough(),
  }).passthrough(),
  // Versioned Laboratory actions already had mode/results, but not the top-level protocol field.
  z.object({
    kind: z.literal('laboratory_test_completed'),
    payload: z.object({
      mode: z.enum(['broad', 'deep', 'impulse']),
      playerId: playerIdSchema,
      results: z.array(z.object({
        publicResult: publicResultSchema,
        receiverSignal: signalIdSchema,
        sourceSignal: signalIdSchema,
      }).passthrough()).min(1).max(2),
    }).passthrough(),
  }).passthrough(),
  // Private Thesis events created before the final audit expansion had no ratingAward.
  z.object({
    kind: z.literal('private_thesis_checked'),
    payload: z.object({
      fieldTypeCorrect: z.boolean(),
      fullyCorrect: z.boolean(),
      playerId: playerIdSchema,
      polarityCorrect: z.boolean(),
      signalId: signalIdSchema,
      thesisId: z.string().min(1).max(128),
    }).passthrough(),
  }).passthrough(),
])

export function hasParticipantAuditSemantics(event: StoredTenderAuditEvent) {
  const unversionedEvent = {
    ...(event.actorId ? { actorId: event.actorId } : {}),
    ...(event.commandId ? { commandId: event.commandId } : {}),
    kind: event.kind,
    payload: event.payload,
  }
  return tenderAuditEventSchema.safeParse(unversionedEvent).success
    || (event.formatVersion === 0
      && historicalParticipantAuditVariantSchema.safeParse(event).success)
}

export function assertCurrentParticipantAuditSemantics(
  tender: StoredTender,
  events: StoredTenderAuditEvent[],
) {
  if (tender.ruleset === 'tender-v2' && tender.publicTheses.length > 0) {
    const currentPublicThesisEvent = events.find((event) =>
      event.kind === 'thesis_checked' && event.formatVersion === 1,
    )
    if (currentPublicThesisEvent) throw participantAuditMismatch(currentPublicThesisEvent)
  }

  let currentRound = 1
  let accessResolved = false
  for (const event of events) {
    if (!affectsParticipantRounds(event.kind)) continue
    const startsNextRound = event.kind === 'access_slot_requested'
      || event.kind === 'access_slot_timeout_resolved'
    if (startsNextRound && accessResolved) {
      currentRound = Math.min(currentRound + 1, tender.round)
      accessResolved = false
    }
    if (event.formatVersion === 1) {
      assertParticipantEventMembership(tender, event)
      if (event.kind === 'contract_bid_assessed') {
        assertContractBidSemantics(tender, event, currentRound)
      }
    }
    if (event.kind === 'access_slots_resolved' || event.kind === 'access_slot_timeout_resolved') {
      accessResolved = true
    }
  }
}

export function createParticipantAuditRounds(
  tender: StoredTender,
  events: StoredTenderAuditEvent[],
): TenderAuditRound[] {
  assertCurrentParticipantAuditSemantics(tender, events)
  if (tender.ruleset === 'tender-v2' && tender.publicTheses.length > 0) {
    throw new TenderAuditEventDecodeError(
      'Public v2 Tender Theses predate the private participant audit semantics',
      'historical_incompatible',
    )
  }
  const rounds = Array.from({ length: tender.round }, (_, index) => emptyRound(tender, index + 1))
  const roundAt = (round: number) => rounds[Math.min(Math.max(round, 1), rounds.length) - 1]!
  const contractByEvidence = new Map<string, string>()
  const journalByTestId = new Map(tender.publicScientificJournal.map((entry) => [entry.testId, entry]))

  for (const event of events) {
    if (event.kind !== 'contract_bid_assessed' || event.payload.awarded !== true) continue
    const contractId = stringValue(event.payload.contractId)
    if (!contractId) continue
    for (const testId of stringArray(event.payload.evidenceTestIds)) {
      contractByEvidence.set(testId, contractId)
    }
  }

  let currentRound = 1
  let accessResolved = false
  let journalCursor = 0
  let publicThesisCursor = 0
  const privateThesisCursorByPlayer = new Map<string, number>()
  const awardedThesisSignalsByPlayer = new Map<string, Set<string>>()
  const measurementCursorByPlayer = new Map<string, number>()
  const requestedSlotsByRound = new Map<number, Map<string, number>>()

  for (const event of events) {
    if (!affectsParticipantRounds(event.kind)) continue
    const startsNextRound = event.kind === 'access_slot_requested'
      || event.kind === 'access_slot_timeout_resolved'
    if (startsNextRound && accessResolved) {
      currentRound = Math.min(currentRound + 1, tender.round)
      accessResolved = false
    }
    const round = roundAt(currentRound)
    const playerId = assertParticipantEventMembership(tender, event)

    if (event.kind === 'access_slot_requested' && playerId) {
      const requestedSlot = integerValue(event.payload.slot)
      if (requestedSlot) {
        const requests = requestedSlotsByRound.get(currentRound) ?? new Map<string, number>()
        requests.set(playerId, requestedSlot)
        requestedSlotsByRound.set(currentRound, requests)
      }
      continue
    }

    if (event.kind === 'access_slots_resolved' || event.kind === 'access_slot_timeout_resolved') {
      const accessSlots = event.payload.accessSlots
      const timedOut = new Set(stringArray(payloadValue(event.payload, 'timedOutPlayerIds')))
      if (typeof accessSlots === 'object' && accessSlots !== null) {
        for (const [candidateId, assigned] of Object.entries(accessSlots)) {
          const assignedSlot = integerValue(assigned)
          if (!assignedSlot) continue
          round.accessSlots.push({
            assignedSlot,
            playerId: candidateId,
            ...(requestedSlotsByRound.get(currentRound)?.get(candidateId)
              ? { requestedSlot: requestedSlotsByRound.get(currentRound)!.get(candidateId) }
              : {}),
            resolution: timedOut.has(candidateId) ? 'timeout' : 'confirmed',
          })
        }
      }
      accessResolved = true
      continue
    }

    if (event.kind === 'power_allocated' && playerId) {
      const allocation = event.payload.allocation
      if (typeof allocation === 'object' && allocation !== null) {
        round.powerAllocations.push({
          allocation: allocation as PowerAllocation,
          playerId,
          resolution: 'confirmed',
        })
      }
      continue
    }

    if (event.kind === 'power_allocation_timeout_resolved') {
      for (const candidateId of stringArray(event.payload.timedOutPlayerIds)) {
        round.powerAllocations.push({
          allocation: timeoutAllocation,
          playerId: candidateId,
          resolution: 'timeout',
        })
      }
      continue
    }

    if (event.kind === 'reconnaissance_completed' && playerId) {
      round.reconnaissance.push({
        playerId,
        resolution: 'completed',
        targets: stringArray(event.payload.targets) as TenderAuditRound['reconnaissance'][number]['targets'],
      })
      continue
    }

    if (event.kind === 'operational_action_timeout_resolved'
      && event.payload.phase === 'reconnaissance'
      && playerId) {
      round.reconnaissance.push({ playerId, resolution: 'timeout', targets: [] })
      continue
    }

    if (event.kind === 'operational_action_auto_skipped'
      && event.payload.phase === 'reconnaissance'
      && playerId) {
      round.reconnaissance.push({
        playerId,
        resolution: 'skipped',
        skipReason: 'all_samples_collected',
        targets: [],
      })
      continue
    }

    if (event.kind === 'laboratory_test_completed' && playerId) {
      const results = Array.isArray(event.payload.results) ? event.payload.results : []
      const tests = results.flatMap((rawResult) => {
        if (typeof rawResult !== 'object' || rawResult === null) return []
        const journalEntry = tender.publicScientificJournal[journalCursor]
        journalCursor += 1
        if (!journalEntry) return []
        return [{
          ...journalEntry,
          ...(contractByEvidence.get(journalEntry.testId)
            ? { usedByContractId: contractByEvidence.get(journalEntry.testId) }
            : {}),
        }]
      })
      const measurementCursor = measurementCursorByPlayer.get(playerId) ?? 0
      const privateMeasurements = event.payload.mode === 'deep'
        ? (tender.privateMeasurementsByPlayer[playerId] ?? []).slice(measurementCursor, measurementCursor + 1)
        : []
      if (privateMeasurements.length > 0) {
        measurementCursorByPlayer.set(playerId, measurementCursor + privateMeasurements.length)
      }
      round.laboratory.push({
        mode: event.payload.mode === 'broad'
          ? 'broad'
          : event.payload.mode === 'deep' ? 'deep' : 'impulse',
        playerId,
        ...(event.payload.mode === 'deep'
          ? { privateMeasurements }
          : {}),
        resolution: 'completed',
        tests,
      })
      continue
    }

    if (event.kind === 'operational_action_timeout_resolved'
      && event.payload.phase === 'laboratory'
      && playerId) {
      round.laboratory.push({
        mode: 'impulse',
        playerId,
        resolution: 'timeout',
        tests: [],
      })
      continue
    }

    if (event.kind === 'operational_action_auto_skipped'
      && event.payload.phase === 'laboratory'
      && playerId) {
      round.laboratory.push({
        mode: 'impulse',
        playerId,
        resolution: 'skipped',
        skipReason: event.payload.reason === 'insufficient_samples'
          ? 'insufficient_samples'
          : 'all_pairs_researched',
        tests: [],
      })
      continue
    }

    if (event.kind === 'contract_bid_assessed' && playerId) {
      const {
        awarded,
        conditions,
        contractId,
        ratingAward,
      } = assertContractBidSemantics(tender, event, currentRound)
      if (contractId) {
        round.contracts.push({
          conditions,
          contractId,
          evidenceTestIds: stringArray(event.payload.evidenceTestIds),
          evidenceTests: stringArray(event.payload.evidenceTestIds)
            .flatMap((testId) => journalByTestId.get(testId) ?? []),
          outcome: awarded ? 'awarded' : 'failed',
          playerId,
          ratingAward,
          ...(stringValue(event.payload.researchCertificationSignal)
            ? { researchCertificationSignal: stringValue(event.payload.researchCertificationSignal) as never }
            : {}),
        })
        if (awarded && ratingAward !== 0) {
          round.ratingChanges.push({ playerId, points: ratingAward, source: 'contract' })
        }
      }
      continue
    }

    if (event.kind === 'contract_skipped_no_eligible_contract' && playerId) {
      round.contracts.push({
        evidenceTestIds: [],
        evidenceTests: [],
        outcome: 'skipped',
        playerId,
        ratingAward: 0,
      })
      continue
    }

    if (event.kind === 'contract_reservation_timeout_released' && playerId) {
      round.contracts.push({
        ...(stringValue(event.payload.contractId)
          && reconstructContractConditions(tender, currentRound, stringValue(event.payload.contractId)!)
          ? { conditions: reconstructContractConditions(tender, currentRound, stringValue(event.payload.contractId)!) }
          : {}),
        ...(stringValue(event.payload.contractId) ? { contractId: stringValue(event.payload.contractId) } : {}),
        evidenceTestIds: [],
        evidenceTests: [],
        outcome: 'timeout_released',
        playerId,
        ratingAward: 0,
      })
      continue
    }

    if (event.kind === 'private_thesis_checked' && playerId) {
      const thesisCursor = privateThesisCursorByPlayer.get(playerId) ?? 0
      const thesis = tender.privateThesesByPlayer[playerId]?.[thesisCursor]
      const awardedSignals = awardedThesisSignalsByPlayer.get(playerId) ?? new Set<string>()
      const certifiedSignals = new Set(tender.certifiedSignalsByPlayer[playerId] ?? [])
      const actual = thesis
        ? tender.anomalyConfiguration.signals[thesis.signalId]
        : undefined
      const stateFieldTypeCorrect = thesis && actual
        ? thesis.fieldType === actual.fieldType
        : false
      const statePolarityCorrect = thesis && actual
        ? thesis.polarity === actual.polarity
        : false
      const earnsReward = thesis?.fullyCorrect === true
        && certifiedSignals.has(thesis.signalId)
        && !awardedSignals.has(thesis.signalId)
      const recordedAward = integerValue(event.payload.ratingAward)
      if (
        !thesis
        || !actual
        || thesis.round !== currentRound
        || thesis.id !== stringValue(event.payload.thesisId)
        || thesis.signalId !== stringValue(event.payload.signalId)
        || thesis.fieldTypeCorrect !== stateFieldTypeCorrect
        || thesis.polarityCorrect !== statePolarityCorrect
        || thesis.fullyCorrect !== (stateFieldTypeCorrect && statePolarityCorrect)
        || thesis.fieldTypeCorrect !== event.payload.fieldTypeCorrect
        || thesis.polarityCorrect !== event.payload.polarityCorrect
        || thesis.fullyCorrect !== event.payload.fullyCorrect
        || (recordedAward !== undefined && recordedAward !== (earnsReward ? 1 : 0))
      ) {
        throw participantAuditMismatch(event)
      }
      privateThesisCursorByPlayer.set(playerId, thesisCursor + 1)
      round.theses.push({ ...thesis, playerId })
      if (earnsReward) {
        awardedSignals.add(thesis.signalId)
        awardedThesisSignalsByPlayer.set(playerId, awardedSignals)
        round.ratingChanges.push({ playerId, points: 1, source: 'thesis' })
      }
      continue
    }

    if (event.kind === 'thesis_checked' && playerId) {
      const publicThesis = tender.publicTheses[publicThesisCursor]
      publicThesisCursor += 1
      if (
        !publicThesis
        || publicThesis.playerId !== playerId
        || publicThesis.signalId !== event.payload.signalId
        || publicThesis.correct !== event.payload.correct
      ) {
        throw participantAuditMismatch(event)
      }
      const actual = tender.anomalyConfiguration.signals[publicThesis.signalId]
      const fieldTypeCorrect = publicThesis.fieldType === actual.fieldType
      const polarityCorrect = publicThesis.polarity === actual.polarity
      if (publicThesis.correct !== (fieldTypeCorrect && polarityCorrect)) {
        throw participantAuditMismatch(event)
      }
      round.theses.push({
        fieldType: publicThesis.fieldType,
        fieldTypeCorrect,
        fullyCorrect: publicThesis.correct,
        id: event.commandId ?? `historical-thesis-${event.sequence}`,
        playerId,
        polarity: publicThesis.polarity,
        polarityCorrect,
        round: currentRound,
        signalId: publicThesis.signalId,
      })
      if (publicThesis.correct) {
        round.ratingChanges.push({ playerId, points: 1, source: 'thesis' })
      }
      continue
    }

    if (event.kind === 'scientific_model_scored' && playerId) {
      const points = integerValue(event.payload.ratingAward) ?? 0
      if (points !== 0) round.ratingChanges.push({ playerId, points, source: 'final_model' })
    }
  }

  if (publicThesisCursor !== tender.publicTheses.length) {
    throw currentParticipantAuditStateMismatch(
      'Tender Thesis events cannot reconstruct the participant audit',
    )
  }

  if (tender.ruleset === 'tender-v2') {
    const thesisPlayerIds = new Set([
      ...tender.players.map((player) => player.id),
      ...Object.keys(tender.privateThesesByPlayer),
      ...Object.keys(tender.certifiedSignalsByPlayer),
    ])
    for (const playerId of thesisPlayerIds) {
      const theses = tender.privateThesesByPlayer[playerId] ?? []
      const certifiedSignals = new Set(tender.certifiedSignalsByPlayer[playerId] ?? [])
      const awardedSignals = awardedThesisSignalsByPlayer.get(playerId) ?? new Set<string>()
      if ((privateThesisCursorByPlayer.get(playerId) ?? 0) !== theses.length) {
        throw currentParticipantAuditStateMismatch(
          'Private Tender Thesis state has no matching audit event',
        )
      }
      if (certifiedSignals.size !== (tender.certifiedSignalsByPlayer[playerId] ?? []).length) {
        throw currentParticipantAuditStateMismatch(
          'Private Tender Thesis certifications contain duplicates',
        )
      }
      if (
        certifiedSignals.size !== awardedSignals.size
        || [...certifiedSignals].some((signalId) => !awardedSignals.has(signalId))
        || theses.some((thesis) => thesis.fullyCorrect && !certifiedSignals.has(thesis.signalId))
      ) {
        throw participantAuditStateMismatch(
          events,
          'private_thesis_checked',
          'Private Tender Thesis events cannot reconstruct the participant audit',
        )
      }
    }
  }

  return rounds
}

function reconstructContractConditions(
  tender: StoredTender,
  round: number,
  contractId: string,
) {
  const contract = contractId === finalContractId
    ? tender.publicFinalContract
    : createRoundContracts(
        round,
        tender.players.length,
        tender.anomalyConfiguration.seed,
        tender.contractDeckVersion ?? 'legacy-v1',
      )
        .find((candidate) => candidate.contractId === contractId)
  if (
    !contract?.kind
    || contract.ratingReward === undefined
    || !contract.targetSignal
    || !contract.targetRole
  ) return undefined
  return {
    kind: contract.kind,
    ratingReward: contract.ratingReward,
    requiredPublicResult: contract.requiredPublicResult,
    ...(contract.requiredSecondaryPublicResult
      ? { requiredSecondaryPublicResult: contract.requiredSecondaryPublicResult }
      : {}),
    targetRole: contract.targetRole,
    targetSignal: contract.targetSignal,
  }
}

function assertParticipantEventMembership(
  tender: StoredTender,
  event: StoredTenderAuditEvent,
) {
  const participantIds = new Set(tender.players.map((player) => player.id))
  const playerId = stringValue(payloadValue(event.payload, 'playerId')) ?? event.actorId
  const aggregatePlayerIds: string[] = []
  if (event.kind === 'access_slots_resolved' || event.kind === 'access_slot_timeout_resolved') {
    const accessSlots = payloadValue(event.payload, 'accessSlots')
    if (typeof accessSlots === 'object' && accessSlots !== null) {
      aggregatePlayerIds.push(...Object.keys(accessSlots))
    }
  }
  if (event.kind === 'access_slot_timeout_resolved' || event.kind === 'power_allocation_timeout_resolved') {
    aggregatePlayerIds.push(...stringArray(payloadValue(event.payload, 'timedOutPlayerIds')))
  }
  if (
    (playerId !== undefined && !participantIds.has(playerId))
    || aggregatePlayerIds.some((candidateId) => !participantIds.has(candidateId))
    || (playerId !== undefined && event.actorId !== undefined && event.actorId !== playerId)
    || (
      playerId !== undefined
      && event.formatVersion === 1
      && requiresAuthenticatedActor(event.kind)
      && event.actorId === undefined
    )
  ) {
    throw participantAuditMismatch(event)
  }
  return playerId
}

function assertContractBidSemantics(
  tender: StoredTender,
  event: StoredTenderAuditEvent,
  currentRound: number,
) {
  const playerId = stringValue(payloadValue(event.payload, 'playerId')) ?? event.actorId
  const awardedValue = payloadValue(event.payload, 'awarded')
  const awarded = awardedValue === true
  const contractId = stringValue(payloadValue(event.payload, 'contractId'))
  const ratingAward = integerValue(payloadValue(event.payload, 'ratingAward'))
  const conditions = contractId
    ? reconstructContractConditions(tender, currentRound, contractId)
    : undefined
  const awardedToValue = payloadValue(event.payload, 'awardedToPlayerId')
  const awardedToPlayerId = stringValue(awardedToValue)
  const validAwardedToPlayer = awardedToPlayerId === playerId
    || (event.formatVersion === 0 && awardedToValue === undefined)
  if (
    playerId === undefined
    || typeof awardedValue !== 'boolean'
    || contractId === undefined
    || ratingAward === undefined
    || conditions === undefined
    || (event.formatVersion === 1 && tender.ruleset === 'tender-v2' && !awarded)
    || (awarded
      ? !validAwardedToPlayer || ratingAward !== conditions.ratingReward
      : awardedToValue !== undefined || ratingAward !== 0)
  ) {
    throw participantAuditMismatch(event)
  }

  const evidenceTestIds = stringArray(payloadValue(event.payload, 'evidenceTestIds'))
  const researchCertificationSignal = stringValue(
    payloadValue(event.payload, 'researchCertificationSignal'),
  )
  if (awarded && !isContractEvidenceSelectionEligible(
    {
      corporateTrustByPlayer: { [playerId]: 2 },
      publicScientificJournal: tender.publicScientificJournal,
      researchCertificationsByPlayer: researchCertificationSignal
        ? { [playerId]: [researchCertificationSignal as never] }
        : {},
      round: contractId === finalContractId ? 5 : currentRound,
      usedContractEvidenceTestIds: [],
    },
    playerId,
    { contractId, ...conditions },
    evidenceTestIds,
    researchCertificationSignal as never,
  )) {
    throw participantAuditMismatch(event)
  }

  return { awarded, conditions, contractId, ratingAward }
}

function requiresAuthenticatedActor(kind: TenderAuditEventKind) {
  switch (kind) {
    case 'access_slot_requested':
    case 'contract_bid_assessed':
    case 'contract_skipped_no_eligible_contract':
    case 'laboratory_test_completed':
    case 'power_allocated':
    case 'private_thesis_checked':
    case 'reconnaissance_completed':
    case 'scientific_model_scored':
    case 'thesis_checked':
      return true
    default:
      return false
  }
}

function affectsParticipantRounds(kind: TenderAuditEventKind) {
  switch (kind) {
    case 'access_slot_requested':
    case 'access_slots_resolved':
    case 'access_slot_timeout_resolved':
    case 'contract_bid_assessed':
    case 'contract_reservation_timeout_released':
    case 'contract_skipped_no_eligible_contract':
    case 'laboratory_test_completed':
    case 'operational_action_auto_skipped':
    case 'operational_action_timeout_resolved':
    case 'power_allocated':
    case 'power_allocation_timeout_resolved':
    case 'private_thesis_checked':
    case 'reconnaissance_completed':
    case 'scientific_model_scored':
    case 'thesis_checked':
      return true
    case 'contract_reserved':
    case 'final_scientific_model_timeout_resolved':
    case 'model_analysis_finished_early':
    case 'model_analysis_timeout_resolved':
    case 'player_forfeited_tender':
    case 'player_left_tender':
    case 'player_resumed_tender':
    case 'scientific_model_draft_updated':
    case 'tender_abandoned':
    case 'tender_completed_early':
    case 'thesis_skipped_corporate_review':
    case 'working_model_updated':
      return false
    default:
      return assertNever(kind)
  }
}

function participantAuditMismatch(event: StoredTenderAuditEvent) {
  return new TenderAuditEventDecodeError(
    `Tender audit event ${event.kind} at sequence ${event.sequence} does not match persisted state`,
    event.formatVersion === 0 ? 'historical_incompatible' : 'current_corruption',
  )
}

function currentParticipantAuditStateMismatch(message: string) {
  return new TenderAuditEventDecodeError(message, 'current_corruption')
}

function participantAuditStateMismatch(
  events: StoredTenderAuditEvent[],
  relevantKind: 'private_thesis_checked' | 'thesis_checked',
  message: string,
) {
  const relevantEvents = events.filter((event) => event.kind === relevantKind)
  return new TenderAuditEventDecodeError(
    message,
    relevantEvents.length > 0 && relevantEvents.every((event) => event.formatVersion === 0)
      ? 'historical_incompatible'
      : 'current_corruption',
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Tender audit event kind: ${String(value)}`)
}
