import type { PublicContract, ScientificJournalEntry } from '@anomaly-detector/contracts'

import type { SignalId } from './anomaly-configuration'

export const finalContractId = 'final-contract'

type ContractEligibilityState = {
  corporateTrustByPlayer: Record<string, number>
  publicScientificJournal: ScientificJournalEntry[]
  researchCertificationsByPlayer: Record<string, SignalId[]>
  round: number
  usedContractEvidenceTestIds: string[]
}

type TenderContract = PublicContract

export const createContractPlanning = (
  tender: ContractEligibilityState,
  playerId: string,
  contract: TenderContract,
) => {
  const isFinal = contract.contractId === finalContractId || contract.kind === 'final'
  const kind = contract.kind ?? (isFinal ? 'final' : 'light')
  const role = contract.targetRole ?? 'source'
  const ownEvidence = tender.publicScientificJournal.filter((entry) => entry.playerId === playerId)
  const unusedEvidence = ownEvidence.filter((entry) => !tender.usedContractEvidenceTestIds.includes(entry.testId))
  const availableEvidence = unusedEvidence.filter((entry) =>
    entry[role === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal,
  )
  const suitableResearchCertificationSignals = kind === 'scientific'
    && contract.targetSignal
    && (tender.researchCertificationsByPlayer[playerId] ?? []).includes(contract.targetSignal)
    ? [contract.targetSignal]
    : []
  const primaryEvidence = availableEvidence.filter((entry) =>
    entry.publicResult === contract.requiredPublicResult,
  )
  const secondary = contract.requiredSecondaryPublicResult
    ?? (contract.requiredPublicResult === 'reflection' ? 'attenuation' : 'reflection')
  const secondaryEvidence = availableEvidence.filter((entry) => entry.publicResult === secondary)
  const continuousEvidence = [...primaryEvidence, ...secondaryEvidence]
    .filter((entry, index, entries) =>
      entry.protocol === 'continuous'
      && entries.findIndex((candidate) => candidate.testId === entry.testId) === index,
    )
  const primaryImpulseEvidence = primaryEvidence.filter((entry) => entry.protocol === 'impulse')
  const secondaryImpulseEvidence = secondaryEvidence.filter((entry) => entry.protocol === 'impulse')
  const suitableEvidenceSelections = kind === 'scientific'
    ? []
    : kind === 'light'
      ? primaryEvidence.map((entry) => [entry.testId])
      : [
          ...continuousEvidence.map((entry) => [entry.testId]),
          ...primaryImpulseEvidence.flatMap((primary) =>
            secondaryImpulseEvidence.map((secondaryEntry) => [primary.testId, secondaryEntry.testId]),
          ),
        ]
  const suitableEvidence = tender.publicScientificJournal.filter((entry) =>
    suitableEvidenceSelections.some((selection) => selection.includes(entry.testId)),
  )
  const hasEvidence = kind === 'scientific'
    ? suitableResearchCertificationSignals.length > 0
    : suitableEvidenceSelections.length > 0
  const missingConditions: NonNullable<NonNullable<TenderContract['planning']>['missingConditions']> = []
  if (contract.bidOutcome !== undefined) missingConditions.push('already_resolved')
  if (contract.reservedByPlayerId && contract.reservedByPlayerId !== playerId) missingConditions.push('reserved')
  if (isFinal && tender.round !== 5) missingConditions.push('final_round')
  if (isFinal && (tender.corporateTrustByPlayer[playerId] ?? 0) < 2) missingConditions.push('corporate_trust')
  if (!hasEvidence) {
    if (kind === 'scientific') {
      missingConditions.push('evidence')
    } else {
      const acceptedResults = new Set([contract.requiredPublicResult, secondary])
      const usedSuitableEvidence = ownEvidence.some((entry) =>
        tender.usedContractEvidenceTestIds.includes(entry.testId)
        && entry[role === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal
        && acceptedResults.has(entry.publicResult),
      )
      const hasWrongRoleEvidence = unusedEvidence.some((entry) =>
        entry[role === 'source' ? 'receiverSignal' : 'sourceSignal'] === contract.targetSignal
        && acceptedResults.has(entry.publicResult),
      )
      missingConditions.push(
        usedSuitableEvidence
          ? 'evidence_used'
          : hasWrongRoleEvidence
            ? 'evidence_role'
            : availableEvidence.length > 0
              ? 'evidence_result'
              : 'evidence',
      )
    }
  }
  return {
    eligible: missingConditions.length === 0,
    missingConditions,
    requiredPower: 1 as const,
    suitableEvidenceSelections,
    suitableEvidenceTestIds: suitableEvidence.map((entry) => entry.testId),
    suitableResearchCertificationSignals,
  }
}

export const isContractEligible = (
  tender: ContractEligibilityState,
  playerId: string,
  contract: TenderContract,
) => createContractPlanning(tender, playerId, contract).eligible

export const isContractEvidenceSelectionEligible = (
  tender: ContractEligibilityState,
  playerId: string,
  contract: TenderContract,
  evidenceTestIds: string[],
  researchCertificationSignal?: SignalId,
) => {
  const planning = createContractPlanning(tender, playerId, contract)
  if (!planning.eligible || evidenceTestIds.length !== new Set(evidenceTestIds).size) return false
  const kind = contract.kind ?? (contract.contractId === finalContractId ? 'final' : 'light')
  if (kind === 'scientific') {
    return evidenceTestIds.length === 0
      && researchCertificationSignal !== undefined
      && planning.suitableResearchCertificationSignals.includes(researchCertificationSignal)
  }
  return planning.suitableEvidenceSelections.some((selection) =>
    selection.length === evidenceTestIds.length
    && selection.every((testId) => evidenceTestIds.includes(testId)),
  )
}
