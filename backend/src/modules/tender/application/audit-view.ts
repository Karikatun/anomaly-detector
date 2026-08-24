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
import { createRoundContracts } from '../domain/contracts'
import {
  tenderAuditEventSchema,
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

export function createParticipantAuditRounds(
  tender: StoredTender,
  events: StoredTenderAuditEvent[],
): TenderAuditRound[] {
  const rounds = Array.from({ length: tender.round }, (_, index) => emptyRound(tender, index + 1))
  const roundAt = (round: number) => rounds[Math.min(Math.max(round, 1), rounds.length) - 1]!
  const contractByEvidence = new Map<string, string>()
  const journalByTestId = new Map(tender.publicScientificJournal.map((entry) => [entry.testId, entry]))
  const contractConditions = (round: number, contractId: string) => {
    const contract = contractId === 'final-contract'
      ? tender.publicFinalContract
      : createRoundContracts(round, tender.players.length, tender.anomalyConfiguration.seed)
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
    const playerId = stringValue(payloadValue(event.payload, 'playerId')) ?? event.actorId

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
      const awarded = event.payload.awarded === true
      const contractId = stringValue(event.payload.contractId)
      if (awarded && contractId) {
        const ratingAward = integerValue(event.payload.ratingAward) ?? 0
        round.contracts.push({
          ...(contractConditions(currentRound, contractId)
            ? { conditions: contractConditions(currentRound, contractId) }
            : {}),
          contractId,
          evidenceTestIds: stringArray(event.payload.evidenceTestIds),
          evidenceTests: stringArray(event.payload.evidenceTestIds)
            .flatMap((testId) => journalByTestId.get(testId) ?? []),
          outcome: 'awarded',
          playerId,
          ratingAward,
          ...(stringValue(event.payload.researchCertificationSignal)
            ? { researchCertificationSignal: stringValue(event.payload.researchCertificationSignal) as never }
            : {}),
        })
        if (ratingAward !== 0) {
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
          && contractConditions(currentRound, stringValue(event.payload.contractId)!)
          ? { conditions: contractConditions(currentRound, stringValue(event.payload.contractId)!) }
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
      const points = integerValue(event.payload.ratingAward) ?? 0
      if (points !== 0) round.ratingChanges.push({ playerId, points, source: 'thesis' })
      continue
    }

    if (event.kind === 'scientific_model_scored' && playerId) {
      const points = integerValue(event.payload.ratingAward) ?? 0
      if (points !== 0) round.ratingChanges.push({ playerId, points, source: 'final_model' })
    }
  }

  for (const [playerId, theses] of Object.entries(tender.privateThesesByPlayer)) {
    for (const thesis of theses) {
      roundAt(thesis.round).theses.push({ ...thesis, playerId })
    }
  }

  return rounds
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
    case 'thesis_checked':
    case 'thesis_skipped_corporate_review':
    case 'working_model_updated':
      return false
    default:
      return assertNever(kind)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Tender audit event kind: ${String(value)}`)
}
