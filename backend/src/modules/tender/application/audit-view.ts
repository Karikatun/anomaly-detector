import type {
  PowerAllocation,
  TenderAuditEvent,
  TenderAuditRound,
} from '@anomaly-detector/contracts'
import type { StoredTender } from './tender-store'

const timeoutAllocation: PowerAllocation = {
  contracts: 0,
  laboratory: 0,
  modelAnalysis: 0,
  reconnaissance: 0,
  reserve: 4,
}

const emptyRound = (round: number): TenderAuditRound => ({
  accessSlots: [],
  contracts: [],
  laboratory: [],
  powerAllocations: [],
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

export function createParticipantAuditRounds(
  tender: StoredTender,
  events: TenderAuditEvent[],
): TenderAuditRound[] {
  const rounds = Array.from({ length: tender.round }, (_, index) => emptyRound(index + 1))
  const roundAt = (round: number) => rounds[Math.min(Math.max(round, 1), rounds.length) - 1]!
  const contractByEvidence = new Map<string, string>()

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
    const startsNextRound = event.kind === 'access_slot_requested'
      || event.kind === 'access_slot_timeout_resolved'
    if (startsNextRound && accessResolved) {
      currentRound = Math.min(currentRound + 1, tender.round)
      accessResolved = false
    }
    const round = roundAt(currentRound)
    const playerId = stringValue(event.payload.playerId) ?? event.actorId

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
      const timedOut = new Set(stringArray(event.payload.timedOutPlayerIds))
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
          contractId,
          evidenceTestIds: stringArray(event.payload.evidenceTestIds),
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
        outcome: 'skipped',
        playerId,
        ratingAward: 0,
      })
      continue
    }

    if (event.kind === 'contract_reservation_timeout_released' && playerId) {
      round.contracts.push({
        ...(stringValue(event.payload.contractId) ? { contractId: stringValue(event.payload.contractId) } : {}),
        evidenceTestIds: [],
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
