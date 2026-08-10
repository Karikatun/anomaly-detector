import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  PowerAllocation,
  RatingBreakdown,
  ScientificModel,
  TenderCommand,
  TenderPlayer,
  TenderView,
  TenderViewQuery,
} from '@anomaly-detector/contracts'
import { createTenderSchema, tenderCommandSchema, tenderViewQuerySchema } from '@anomaly-detector/contracts'
import { createParticipantAuditRounds } from './application/audit-view'
import type {
  PendingTenderAuditEvent,
  StoredTender,
  StoredTenderAuditEvent,
  TenderStore,
} from './application/tender-store'
import type { DbClient } from '../../db'
import { resolveAccessSlots, rotateTiePriority } from './domain/access-slots'
import { createAnomalyConfiguration, resolvePublicResult, signalIds, type SignalId } from './domain/anomaly-configuration'
import { createRoundContracts } from './domain/contracts'
import { TenderFailure } from './domain/errors'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'
import { createPrismaTenderStore } from './infrastructure/prisma-tender-store'

type CreateTenderModuleOptions = {
  now?: () => Date
  seedGenerator?: () => string
  store?: TenderStore
  onTenderChanged?: (tenderId: string) => void
}

const phaseDurationMs = 90_000
const finalScientificModelDurationMs = 180_000
const operationalGrantBudget = 1
const normalContractRating = 4
const finalContractRating = 8
const completeScientificModelBonus = 3
const finalContractId = 'final-contract'

const createRatingBreakdownByPlayer = (
  tender: StoredTender,
  events: StoredTenderAuditEvent[],
): Record<string, RatingBreakdown> => {
  const breakdownByPlayer = Object.fromEntries(tender.players.map((player) => [
    player.id,
    {
      completeModelBonus: 0,
      contractPoints: 0,
      correctPropertyPoints: 0,
      correctSignalPoints: 0,
      otherPoints: 0,
      thesisPoints: 0,
      total: 0,
    },
  ])) as Record<string, RatingBreakdown>

  for (const event of events) {
    const playerIdValue = (event.payload as Record<string, unknown>).playerId
    const playerId = typeof playerIdValue === 'string' ? playerIdValue : undefined
    if (!playerId) continue
    const breakdown = breakdownByPlayer[playerId]
    if (!breakdown) continue

    if (event.kind === 'thesis_checked' && event.payload.correct === true) {
      breakdown.thesisPoints += 1
    }
    if (event.kind === 'private_thesis_checked' && event.payload.ratingAward === 1) {
      breakdown.thesisPoints += 1
    }
    if (event.kind === 'contract_bid_assessed' && event.payload.awarded === true) {
      const recordedAward = event.payload.ratingAward
      if (typeof recordedAward === 'number' && Number.isInteger(recordedAward)) {
        breakdown.contractPoints += recordedAward
      } else {
        const ratingByPlayer = event.payload.ratingByPlayer
        const recordedTotal = typeof ratingByPlayer === 'object' && ratingByPlayer !== null
          ? (ratingByPlayer as Record<string, unknown>)[playerId]
          : undefined
        if (typeof recordedTotal === 'number' && Number.isInteger(recordedTotal)) {
          breakdown.contractPoints += recordedTotal
            - breakdown.thesisPoints
            - breakdown.contractPoints
        }
      }
    }
    if (event.kind === 'scientific_model_scored') {
      const completeModelBonus = event.payload.completeModelBonus
      const correctProperties = event.payload.correctProperties
      const correctSignals = event.payload.correctSignals
      if (typeof completeModelBonus === 'number' && Number.isInteger(completeModelBonus)) {
        breakdown.completeModelBonus += completeModelBonus
      }
      if (typeof correctProperties === 'number' && Number.isInteger(correctProperties)) {
        breakdown.correctPropertyPoints += correctProperties
      }
      if (typeof correctSignals === 'number' && Number.isInteger(correctSignals)) {
        breakdown.correctSignalPoints += correctSignals
      }
    }
  }

  for (const player of tender.players) {
    const breakdown = breakdownByPlayer[player.id]
    const knownPoints = breakdown.completeModelBonus
      + breakdown.contractPoints
      + breakdown.correctPropertyPoints
      + breakdown.correctSignalPoints
      + breakdown.thesisPoints
    breakdown.otherPoints = (tender.ratingByPlayer[player.id] ?? 0) - knownPoints
    breakdown.total = knownPoints + breakdown.otherPoints
  }

  return breakdownByPlayer
}

const deadlineForPhase = (phase: string, at: Date) => {
  if (phase === 'complete') return null
  const durationMs = phase === 'final-scientific-model'
    ? finalScientificModelDurationMs
    : phaseDurationMs
  return new Date(at.getTime() + durationMs)
}

const reservePowerAllocation: PowerAllocation = {
  contracts: 0,
  laboratory: 0,
  modelAnalysis: 0,
  reconnaissance: 0,
  reserve: 4,
}

const accessSlotBudgetDelta = (slot: number) => {
  if (slot === 1) return -2
  if (slot === 2) return -1
  if (slot === 4 || slot === 6) return 1
  return 0
}

const receivesAccessSlotSampleCompensation = (slot: number) => slot === 5 || slot === 6

const nextCompensationSample = (knownSignals: SignalId[], currentSamples: SignalId[]) =>
  signalIds.find((signalId) => !knownSignals.includes(signalId))
  ?? signalIds.find((signalId) => !currentSamples.includes(signalId))

export function createTenderModule({
  now = () => new Date(),
  seedGenerator = randomUUID,
  store = createInMemoryTenderStore(),
  onTenderChanged,
}: CreateTenderModuleOptions = {}) {
  const readTender = async (tenderId: string) => {
    const tender = await store.read(tenderId)
    if (!tender) throw new TenderFailure('tender_not_found', `Unknown Tender ${tenderId}`)
    return tender
  }

  const readPlayer = (tender: StoredTender, playerId: string) => {
    const player = tender.players.find((candidate) => candidate.id === playerId)
    if (!player) throw new TenderFailure('player_not_in_tender', `Player ${playerId} is not in this Tender`)
    return player
  }

  const fingerprint = (command: TenderCommand) => JSON.stringify(command)
  const isActivePlayer = (tender: StoredTender, playerId: string) =>
    tender.forfeitedAtByPlayer[playerId] === undefined
  const activePlayers = (tender: StoredTender) => tender.players
    .filter((player) => isActivePlayer(tender, player.id))

  const nextReconnaissancePlayer = (tender: StoredTender) => tender.players
    .filter((player) => isActivePlayer(tender, player.id))
    .filter((player) => tender.powerAllocations[player.id]?.reconnaissance > 0 && !tender.reconnaissanceCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const playerHasLegalLaboratoryPair = (tender: StoredTender, playerId: string) => {
    const samples = tender.samplesByPlayer[playerId] ?? []
    return samples.some((sourceSignal) => samples.some((receiverSignal) =>
      sourceSignal !== receiverSignal
      && !tender.publicScientificJournal.some((entry) =>
        entry.playerId === playerId
        && entry.sourceSignal === sourceSignal
        && entry.receiverSignal === receiverSignal,
      ),
    ))
  }

  const nextLaboratoryPlayer = (tender: StoredTender) => tender.players
    .filter((player) => isActivePlayer(tender, player.id))
    .filter((player) => tender.powerAllocations[player.id]?.laboratory > 0 && !tender.laboratoryCompletedByPlayer[player.id])
    .filter((player) => playerHasLegalLaboratoryPair(tender, player.id))
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const playerAlreadyResearchedPair = (
    tender: StoredTender,
    playerId: string,
    pair: { receiverSignal: SignalId; sourceSignal: SignalId },
  ) => tender.publicScientificJournal.some((entry) =>
    entry.playerId === playerId
    && entry.sourceSignal === pair.sourceSignal
    && entry.receiverSignal === pair.receiverSignal,
  )
  const nextModelAnalysisPlayer = (tender: StoredTender) => tender.players.filter((player) => isActivePlayer(tender, player.id) && tender.powerAllocations[player.id]?.modelAnalysis > 0 && !tender.modelAnalysisCompletedByPlayer[player.id]).sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]
  const modelAnalysisPlayers = (tender: StoredTender) => tender.players
    .filter((player) => isActivePlayer(tender, player.id) && (tender.powerAllocations[player.id]?.modelAnalysis ?? 0) > 0)

  const effectiveContractPower = (tender: StoredTender, playerId: string) => tender.powerAllocations[playerId]?.contracts ?? 0

  const nextContractsPlayer = (tender: StoredTender) => tender.players
    .filter((player) => isActivePlayer(tender, player.id))
    .filter((player) => effectiveContractPower(tender, player.id) > 0)
    .filter((player) => !tender.contractCompletedByPlayer[player.id])
    .filter((player) => tender.publicContracts.every((contract) => contract.reservedByPlayerId !== player.id || contract.bidOutcome === undefined))
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextScientificModelPlayer = (tender: StoredTender) => tender.players
    .filter((player) => isActivePlayer(tender, player.id))
    .filter((player) => !tender.finalScientificModelCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]
  const finalScientificModelPlayers = (tender: StoredTender) => activePlayers(tender)

  const createFinalScientificModelDrafts = (tender: StoredTender) => Object.fromEntries(
    finalScientificModelPlayers(tender).map((player) => {
      const workingSignals = tender.privateWorkingModelsByPlayer[player.id]?.signals ?? {}
      const signals = Object.fromEntries(
        Object.entries(workingSignals).flatMap(([signalId, state]) => {
          const hypothesis = state.hypothesis
          if (!hypothesis || (hypothesis.fieldType === undefined && hypothesis.polarity === undefined)) return []
          return [[signalId, {
            ...(hypothesis.fieldType ? { fieldType: hypothesis.fieldType } : {}),
            ...(hypothesis.polarity ? { polarity: hypothesis.polarity } : {}),
          }]]
        }),
      )
      return [player.id, { signals }]
    }),
  )

  const contractPlanningForPlayer = (
    tender: StoredTender,
    playerId: string,
    contract: StoredTender['publicContracts'][number],
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
    const matchesPrimary = (entry: (typeof availableEvidence)[number]) =>
      entry.publicResult === contract.requiredPublicResult
    const secondary = contract.requiredSecondaryPublicResult
      ?? (contract.requiredPublicResult === 'reflection' ? 'attenuation' : 'reflection')
    const primaryEvidence = availableEvidence.filter(matchesPrimary)
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
    const missingConditions: NonNullable<NonNullable<StoredTender['publicContracts'][number]['planning']>['missingConditions']> = []
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

  const contractIsEligibleForPlayer = (
    tender: StoredTender,
    playerId: string,
    contract: StoredTender['publicContracts'][number],
  ) => contractPlanningForPlayer(tender, playerId, contract).eligible

  const contractEvidenceSelectionIsEligible = (
    tender: StoredTender,
    playerId: string,
    contract: StoredTender['publicContracts'][number],
    evidenceTestIds: string[],
    researchCertificationSignal?: SignalId,
  ) => {
    const planning = contractPlanningForPlayer(tender, playerId, contract)
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

  const activePlayerIdForView = (tender: StoredTender) => {
    switch (tender.phase) {
      case 'reconnaissance': return nextReconnaissancePlayer(tender)?.id
      case 'laboratory': return nextLaboratoryPlayer(tender)?.id
      case 'model-analysis': return tender.ruleset === 'tender-v1'
        ? nextModelAnalysisPlayer(tender)?.id
        : undefined
      case 'contracts': return nextContractsPlayer(tender)?.id
      case 'final-scientific-model': return tender.ruleset === 'tender-v1'
        ? nextScientificModelPlayer(tender)?.id
        : undefined
      default: return undefined
    }
  }

  const correctThesisCount = (tender: StoredTender, playerId: string) => tender.ruleset === 'tender-v2'
    ? (tender.certifiedSignalsByPlayer[playerId] ?? []).length
    : tender.publicTheses.filter((thesis) => thesis.playerId === playerId && thesis.correct).length

  const compareFinalPlayers = (tender: StoredTender, left: TenderPlayer, right: TenderPlayer) => {
    const leftForfeitedAt = tender.forfeitedAtByPlayer[left.id]
    const rightForfeitedAt = tender.forfeitedAtByPlayer[right.id]
    if (Boolean(leftForfeitedAt) !== Boolean(rightForfeitedAt)) return leftForfeitedAt ? 1 : -1
    if (leftForfeitedAt && rightForfeitedAt) {
      return Date.parse(rightForfeitedAt) - Date.parse(leftForfeitedAt)
    }
    return (tender.ratingByPlayer[right.id] ?? 0) - (tender.ratingByPlayer[left.id] ?? 0)
      || correctThesisCount(tender, right.id) - correctThesisCount(tender, left.id)
      || (tender.budgetByPlayer[right.id] ?? 0) - (tender.budgetByPlayer[left.id] ?? 0)
  }

  const placementByPlayer = (tender: StoredTender) => Object.fromEntries(
    tender.players.map((player) => [
      player.id,
      1 + tender.players.filter((candidate) => compareFinalPlayers(tender, candidate, player) < 0).length,
    ]),
  )

  const finalScientificModelAuditByPlayer = (tender: StoredTender) => Object.fromEntries(
    tender.players.map((player) => {
      const model = tender.finalScientificModelsByPlayer[player.id]
      if (!model) return [player.id, { signals: {}, submitted: false }]
      return [player.id, {
        signals: Object.fromEntries(Object.entries(model.signals).map(([signalId, claim]) => {
          const actual = tender.anomalyConfiguration.signals[signalId as SignalId]
          return [signalId, {
            ...(claim.fieldType
              ? { fieldType: claim.fieldType, fieldTypeCorrect: claim.fieldType === actual.fieldType }
              : {}),
            ...(claim.polarity
              ? { polarity: claim.polarity, polarityCorrect: claim.polarity === actual.polarity }
              : {}),
          }]
        })),
        submitted: true,
      }]
    }),
  )

  const resolveWinners = (tender: StoredTender) => {
    const eligiblePlayers = activePlayers(tender)
    if (eligiblePlayers.length === 0) return []
    const highestRating = Math.max(...eligiblePlayers.map((player) => tender.ratingByPlayer[player.id] ?? 0))
    const ratingLeaders = eligiblePlayers.filter((player) => (tender.ratingByPlayer[player.id] ?? 0) === highestRating)
    const highestThesisCount = Math.max(...ratingLeaders.map((player) => correctThesisCount(tender, player.id)))
    const thesisLeaders = ratingLeaders.filter((player) => correctThesisCount(tender, player.id) === highestThesisCount)
    const highestBudget = Math.max(...thesisLeaders.map((player) => tender.budgetByPlayer[player.id] ?? 0))
    return thesisLeaders.filter((player) => (tender.budgetByPlayer[player.id] ?? 0) === highestBudget).map((player) => player.id)
  }

  const advanceAfterContracts = (tender: StoredTender): StoredTender => {
    if (nextContractsPlayer(tender)) return { ...tender, phase: 'contracts' }
    const budgetByPlayer = Object.fromEntries(tender.players.map((player) => [
      player.id,
      (tender.budgetByPlayer[player.id] ?? 0) + operationalGrantBudget,
    ]))
    const tenderAfterGrant = { ...tender, budgetByPlayer }
    if (tender.round >= 5) return {
      ...tenderAfterGrant,
      finalScientificModelDraftsByPlayer: tender.ruleset === 'tender-v2'
        ? createFinalScientificModelDrafts(tenderAfterGrant)
        : tender.finalScientificModelDraftsByPlayer,
      phase: 'final-scientific-model',
    }
    const round = tender.round + 1
    const publicContracts = createRoundContracts(round, tender.players.length, tender.anomalyConfiguration.seed)
    return {
      ...tenderAfterGrant,
      accessSlots: {},
      contractCompletedByPlayer: {},
      corporateReviewActive: false,
      corporateReviewByPlayer: {},
      laboratoryCompletedByPlayer: {},
      modelAnalysisCompletedByPlayer: {},
      phase: 'access-slot-selection',
      powerAllocations: {},
      knownSignals: [...new Set([...tender.knownSignals, ...publicContracts.map((contract) => contract.targetSignal)])],
      publicContracts,
      reconnaissanceCompletedByPlayer: {},
      requestedSlots: {},
      round,
    }
  }

  const advanceAfterOperationalActions = (tender: StoredTender, after: 'reconnaissance' | 'laboratory' | 'model-analysis'): StoredTender => {
    if (after === 'reconnaissance' && nextLaboratoryPlayer(tender)) return { ...tender, phase: 'laboratory' }
    if (after !== 'model-analysis' && nextModelAnalysisPlayer(tender)) return { ...tender, phase: 'model-analysis' }
    return advanceAfterContracts(tender)
  }

  const markImpossibleOperationalActions = (tender: StoredTender): StoredTender => ({
    ...tender,
    automaticOperationalSkipsByPlayer: {
      ...tender.automaticOperationalSkipsByPlayer,
      ...Object.fromEntries(tender.players.map((player) => {
        const hasAllSamples = (tender.samplesByPlayer[player.id] ?? []).length >= signalIds.length
        if ((tender.powerAllocations[player.id]?.reconnaissance ?? 0) > 0 && hasAllSamples) {
          return [player.id, {
            phase: 'reconnaissance' as const,
            reason: 'all_samples_collected' as const,
            round: tender.round,
          }]
        }
        const insufficientSamples = (tender.samplesByPlayer[player.id] ?? []).length < 2
        if (
          (tender.powerAllocations[player.id]?.laboratory ?? 0) > 0
          && (
            (tender.powerAllocations[player.id]?.reconnaissance ?? 0) === 0
            || tender.reconnaissanceCompletedByPlayer[player.id]
          )
          && !playerHasLegalLaboratoryPair(tender, player.id)
        ) {
          return [player.id, {
            phase: 'laboratory' as const,
            reason: insufficientSamples ? 'insufficient_samples' as const : 'all_pairs_researched' as const,
            round: tender.round,
          }]
        }
        return [player.id, tender.automaticOperationalSkipsByPlayer[player.id]]
      }).filter((entry): entry is [string, NonNullable<(typeof tender.automaticOperationalSkipsByPlayer)[string]>] =>
        entry[1] !== undefined,
      )),
    },
    laboratoryCompletedByPlayer: {
      ...tender.laboratoryCompletedByPlayer,
      ...Object.fromEntries(tender.players
        .filter((player) =>
          (tender.powerAllocations[player.id]?.laboratory ?? 0) > 0
          && (
            (tender.powerAllocations[player.id]?.reconnaissance ?? 0) === 0
            || tender.reconnaissanceCompletedByPlayer[player.id]
          )
          && !playerHasLegalLaboratoryPair(tender, player.id),
        )
        .map((player) => [player.id, true])),
    },
    reconnaissanceCompletedByPlayer: {
      ...tender.reconnaissanceCompletedByPlayer,
      ...Object.fromEntries(tender.players
        .filter((player) =>
          (tender.powerAllocations[player.id]?.reconnaissance ?? 0) > 0
          && (tender.samplesByPlayer[player.id] ?? []).length >= signalIds.length,
        )
        .map((player) => [player.id, true])),
    },
  })

  const beginOperationalActions = (input: StoredTender): StoredTender => {
    const tender = markImpossibleOperationalActions(input)
    return nextReconnaissancePlayer(tender)
      ? { ...tender, phase: 'reconnaissance' }
      : advanceAfterOperationalActions(tender, 'reconnaissance')
  }

  const automaticOperationalSkipEvents = (before: StoredTender, after: StoredTender) =>
    after.players.flatMap((player) => {
      const events: PendingTenderAuditEvent[] = []
      if (!before.reconnaissanceCompletedByPlayer[player.id] && after.reconnaissanceCompletedByPlayer[player.id]) {
        events.push({
          kind: 'operational_action_auto_skipped',
          payload: { phase: 'reconnaissance', playerId: player.id, reason: 'all_samples_collected' },
        })
      }
      if (!before.laboratoryCompletedByPlayer[player.id] && after.laboratoryCompletedByPlayer[player.id]) {
        events.push({
          kind: 'operational_action_auto_skipped',
          payload: {
            phase: 'laboratory',
            playerId: player.id,
            reason: (before.samplesByPlayer[player.id] ?? []).length < 2
              ? 'insufficient_samples'
              : 'all_pairs_researched',
          },
        })
      }
      return events
    })

  const continueAfterForfeit = (tender: StoredTender, changedAt: Date): StoredTender => {
    const remainingPlayers = activePlayers(tender)
    if (tender.phase === 'access-slot-selection') {
      if (!remainingPlayers.every((player) => tender.requestedSlots[player.id] !== undefined)) return tender
      const accessSlots = resolveAccessSlots(rotateTiePriority(remainingPlayers, tender.round), tender.requestedSlots)
      const budgetByPlayer = {
        ...tender.budgetByPlayer,
        ...Object.fromEntries(remainingPlayers.map((player) => [
          player.id,
          (tender.budgetByPlayer[player.id] ?? 0) + accessSlotBudgetDelta(accessSlots[player.id] ?? 3),
        ])),
      }
      const samplesByPlayer = { ...tender.samplesByPlayer }
      const rawTelemetrySignalsByPlayer = { ...tender.rawTelemetrySignalsByPlayer }
      const knownSignals = [...tender.knownSignals]
      for (const player of remainingPlayers) {
        if (!receivesAccessSlotSampleCompensation(accessSlots[player.id] ?? 3)) continue
        const nextSample = nextCompensationSample(knownSignals, samplesByPlayer[player.id] ?? [])
        if (!nextSample) continue
        samplesByPlayer[player.id] = [...(samplesByPlayer[player.id] ?? []), nextSample]
        rawTelemetrySignalsByPlayer[player.id] = [...(rawTelemetrySignalsByPlayer[player.id] ?? []), nextSample]
        if (!knownSignals.includes(nextSample)) knownSignals.push(nextSample)
      }
      return {
        ...tender,
        accessSlots: { ...tender.accessSlots, ...accessSlots },
        budgetByPlayer,
        dueAt: deadlineForPhase('power-allocation', changedAt),
        knownSignals,
        phase: 'power-allocation',
        rawTelemetrySignalsByPlayer,
        samplesByPlayer,
      }
    }
    if (tender.phase === 'power-allocation') {
      if (!remainingPlayers.every((player) => tender.powerAllocations[player.id] !== undefined)) return tender
      const advancedTender = beginOperationalActions(tender)
      return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, changedAt) }
    }
    if (tender.phase === 'reconnaissance' && !nextReconnaissancePlayer(tender)) {
      const advancedTender = advanceAfterOperationalActions(tender, 'reconnaissance')
      return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, changedAt) }
    }
    if (tender.phase === 'laboratory' && !nextLaboratoryPlayer(tender)) {
      const advancedTender = advanceAfterOperationalActions(tender, 'laboratory')
      return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, changedAt) }
    }
    if (tender.phase === 'model-analysis' && !nextModelAnalysisPlayer(tender)) {
      const advancedTender = advanceAfterOperationalActions(tender, 'model-analysis')
      return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, changedAt) }
    }
    if (tender.phase === 'contracts' && !nextContractsPlayer(tender)) {
      const advancedTender = advanceAfterContracts(tender)
      return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, changedAt) }
    }
    if (tender.phase === 'final-scientific-model' && !nextScientificModelPlayer(tender)) {
      return {
        ...tender,
        dueAt: null,
        finalScientificModelDraftsByPlayer: {},
        phase: 'complete',
        winnerPlayerIds: resolveWinners(tender),
      }
    }
    return tender
  }

  const commitCommand = async ({
    auditEvents,
    command,
    commandFingerprint,
    nextTender,
    tender,
  }: {
    auditEvents: Parameters<TenderStore['commit']>[0]['auditEvents']
    command: TenderCommand
    commandFingerprint: string
    nextTender: StoredTender
    tender: StoredTender
  }) => {
    const receipt = { tenderId: command.tenderId, version: tender.version + 1 }
    const result = await store.commit({
      auditEvents,
      tenderId: command.tenderId,
      expectedVersion: tender.version,
      nextTender: { ...nextTender, version: receipt.version },
      commandId: command.commandId,
      command: { fingerprint: commandFingerprint, receipt },
    })
    if (result.kind === 'command_exists') {
      if (result.command.fingerprint !== commandFingerprint) {
        throw new TenderFailure('duplicate_command_conflict', `Command ${command.commandId} conflicts with its first use`)
      }
      return result.command.receipt
    }
    if (result.kind === 'version_conflict') {
      throw new TenderFailure('tender_version_conflict', `Tender ${command.tenderId} changed before command execution`)
    }
    onTenderChanged?.(command.tenderId)
    return receipt
  }

  const commitTimeout = async ({ auditEvents, nextTender, tender }: {
    auditEvents: Parameters<TenderStore['commit']>[0]['auditEvents']
    nextTender: StoredTender
    tender: StoredTender
  }) => {
    const result = await store.commit({
      auditEvents,
      expectedVersion: tender.version,
      nextTender: { ...nextTender, version: tender.version + 1 },
      tenderId: tender.id,
    })
    if (result.kind === 'committed') {
      onTenderChanged?.(tender.id)
    }
    return result.kind === 'committed'
  }

  return {
    async anonymizeParticipant(playerId: string) {
      const changedTenderIds = await store.anonymizeParticipant(playerId)
      for (const tenderId of changedTenderIds) onTenderChanged?.(tenderId)
    },

    async createTender(input: CreateTender) {
      const parsedInput = createTenderSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new TenderFailure('invalid_create_tender', 'Tender creation input is invalid')
      }
      const anomalyConfiguration = createAnomalyConfiguration(seedGenerator())
      const publicContracts = createRoundContracts(1, parsedInput.data.players.length, anomalyConfiguration.seed)
      const publicFinalContract = {
        contractId: finalContractId,
        kind: 'final' as const,
        ratingReward: 8,
        requiredPublicResult: 'reflection' as const,
        requiredSecondaryPublicResult: 'attenuation' as const,
        targetRole: 'source' as const,
        targetSignal: 'ferro' as const,
      }
      const tender = await store.create({
        accessSlots: {},
        abandonmentDueAt: null,
        anomalyConfiguration,
        automaticOperationalSkipsByPlayer: {},
        budgetByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 2])),
        corporateTrustByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 0])),
        corporateReviewActive: false,
        corporateReviewByPlayer: {},
        certifiedSignalsByPlayer: {},
        contractCompletedByPlayer: {},
        contractPowerRestrictionsByPlayer: {},
        departedPlayerIds: [],
        dueAt: deadlineForPhase('access-slot-selection', now()),
        finalScientificModelCompletedByPlayer: {},
        finalScientificModelDraftsByPlayer: {},
        finalScientificModelsByPlayer: {},
        finalScientificModelSubmittedAtByPlayer: {},
        forfeitedAtByPlayer: {},
        knownSignals: [...new Set([...publicContracts.map((contract) => contract.targetSignal), publicFinalContract.targetSignal])],
        powerAllocations: {},
        publicContracts,
        publicFinalContract,
        publicLaboratoryResults: [],
        publicScientificJournal: [],
        publicTheses: [],
        ratingByPlayer: {},
        round: 1,
        ruleset: parsedInput.data.ruleset ?? 'tender-v2',
        rawTelemetrySignalsByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, []])),
        reconnaissanceCompletedByPlayer: {},
        laboratoryCompletedByPlayer: {},
        modelAnalysisCompletedByPlayer: {},
        privateMeasurementsByPlayer: {},
        privateThesesByPlayer: {},
        researchCertificationsByPlayer: {},
        usedContractEvidenceTestIds: [],
        privateWorkingModelsByPlayer: {},
        players: parsedInput.data.players,
        requestedSlots: {},
        samplesByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, []])),
        processedCommands: {},
        phase: 'access-slot-selection',
        version: 0,
        winnerPlayerIds: [],
      })
      return { tenderId: tender.id }
    },

    async execute(commandInput: TenderCommand): Promise<CommandReceipt> {
      const parsedCommand = tenderCommandSchema.safeParse(commandInput)
      if (!parsedCommand.success) {
        throw new TenderFailure('invalid_tender_command', 'Tender command is invalid')
      }
      const command = parsedCommand.data
      const tender = await readTender(command.tenderId)
      const player = readPlayer(tender, command.actorId)
      const commandFingerprint = fingerprint(command)
      const previousCommand = tender.processedCommands[command.commandId]
      if (previousCommand) {
        if (previousCommand.fingerprint !== commandFingerprint) {
          throw new TenderFailure('duplicate_command_conflict', `Command ${command.commandId} conflicts with its first use`)
        }
        return previousCommand.receipt
      }
      if (!isActivePlayer(tender, player.id) && command.type !== 'forfeit-tender') {
        throw new TenderFailure('player_forfeited', 'Player permanently forfeited this Tender')
      }
      if (command.type === 'forfeit-tender') {
        if (tender.phase === 'complete') {
          throw new TenderFailure('invalid_tender_state', 'Tender is already complete')
        }
        const forfeitedAt = now()
        const forfeitedAtByPlayer = {
          ...tender.forfeitedAtByPlayer,
          [player.id]: tender.forfeitedAtByPlayer[player.id] ?? forfeitedAt.toISOString(),
        }
        const forfeitedTender = {
          ...tender,
          contractCompletedByPlayer: { ...tender.contractCompletedByPlayer, [player.id]: true },
          finalScientificModelCompletedByPlayer: {
            ...tender.finalScientificModelCompletedByPlayer,
            [player.id]: true,
          },
          forfeitedAtByPlayer,
          laboratoryCompletedByPlayer: { ...tender.laboratoryCompletedByPlayer, [player.id]: true },
          modelAnalysisCompletedByPlayer: { ...tender.modelAnalysisCompletedByPlayer, [player.id]: true },
          reconnaissanceCompletedByPlayer: { ...tender.reconnaissanceCompletedByPlayer, [player.id]: true },
        }
        const remainingPlayers = activePlayers(forfeitedTender)
        const nextTender = remainingPlayers.length <= 1
          ? {
              ...forfeitedTender,
              completionReason: remainingPlayers.length === 1
                ? 'last_active_player' as const
                : 'all_players_forfeited' as const,
              dueAt: null,
              finalScientificModelDraftsByPlayer: {},
              phase: 'complete' as const,
              winnerPlayerIds: remainingPlayers.map((candidate) => candidate.id),
            }
          : continueAfterForfeit(forfeitedTender, forfeitedAt)
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'player_forfeited_tender',
            payload: {
              forfeitedAt: forfeitedAtByPlayer[player.id],
              playerId: player.id,
            },
          }, ...(nextTender.phase === 'complete'
            ? [{
                kind: 'tender_completed_early',
                payload: {
                  completionReason: remainingPlayers.length === 1
                    ? 'last_active_player' as const
                    : 'all_players_forfeited' as const,
                  winnerPlayerIds: nextTender.winnerPlayerIds,
                },
              } satisfies PendingTenderAuditEvent]
            : [])],
          command,
          commandFingerprint,
          nextTender,
          tender,
        })
      }
      if (command.type === 'leave-tender' || command.type === 'resume-tender') {
        if (tender.phase === 'complete') {
          throw new TenderFailure('invalid_tender_state', 'Tender is already complete')
        }
        const departedPlayerIds = command.type === 'leave-tender'
          ? [...new Set([...tender.departedPlayerIds, player.id])]
          : tender.departedPlayerIds.filter((playerId) => playerId !== player.id)
        const allPlayersLeft = departedPlayerIds.length === tender.players.length
        const abandonmentDueAt = allPlayersLeft
          ? tender.abandonmentDueAt ?? new Date(now().getTime() + 5_000)
          : null
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: command.type === 'leave-tender' ? 'player_left_tender' : 'player_resumed_tender',
            payload: {
              abandonmentDueAt: abandonmentDueAt?.toISOString(),
              playerId: player.id,
            },
          }],
          command,
          commandFingerprint,
          nextTender: {
            ...tender,
            abandonmentDueAt,
            departedPlayerIds,
          },
          tender,
        })
      }
      if (tender.dueAt !== null && now() >= tender.dueAt) {
        throw new TenderFailure('tender_deadline_expired', 'Tender action deadline expired')
      }
      if (command.type === 'request-access-slot') {
        if (tender.phase !== 'access-slot-selection') {
          throw new TenderFailure('invalid_tender_state', 'Access Slot selection is closed')
        }
        const requestedSlots = { ...tender.requestedSlots, [player.id]: command.slot }
        const currentActivePlayers = activePlayers(tender)
        const isReadyToResolve = currentActivePlayers.every((candidate) => requestedSlots[candidate.id] !== undefined)
        const accessSlots = isReadyToResolve ? resolveAccessSlots(rotateTiePriority(currentActivePlayers, tender.round), requestedSlots) : tender.accessSlots
        const budgetByPlayer = isReadyToResolve
          ? Object.fromEntries(tender.players.map((player) => [
            player.id,
            (tender.budgetByPlayer[player.id] ?? 0) + accessSlotBudgetDelta(accessSlots[player.id] ?? 3),
          ]))
          : tender.budgetByPlayer
        const sampleCompensationByPlayer: Record<string, SignalId> = {}
        const samplesByPlayer = isReadyToResolve ? { ...tender.samplesByPlayer } : tender.samplesByPlayer
        const knownSignals = isReadyToResolve ? [...tender.knownSignals] : tender.knownSignals
        if (isReadyToResolve) {
          for (const player of currentActivePlayers) {
            if (!receivesAccessSlotSampleCompensation(accessSlots[player.id] ?? 3)) continue
            const nextSample = nextCompensationSample(knownSignals, samplesByPlayer[player.id] ?? [])
            if (!nextSample) continue
            sampleCompensationByPlayer[player.id] = nextSample
            samplesByPlayer[player.id] = [...(samplesByPlayer[player.id] ?? []), nextSample]
            if (!knownSignals.includes(nextSample)) knownSignals.push(nextSample)
          }
        }
        const phase = isReadyToResolve ? 'power-allocation' : tender.phase
        return commitCommand({
          auditEvents: [
            {
              actorId: command.actorId,
              commandId: command.commandId,
              kind: 'access_slot_requested',
              payload: { slot: command.slot, playerId: player.id },
            },
            ...(isReadyToResolve ? [{
              kind: 'access_slots_resolved',
              payload: { accessSlots, budgetByPlayer, sampleCompensationByPlayer },
            } satisfies PendingTenderAuditEvent] : []),
          ],
          command,
          commandFingerprint,
          nextTender: {
            ...tender,
            accessSlots,
            budgetByPlayer,
            dueAt: isReadyToResolve ? deadlineForPhase('power-allocation', now()) : tender.dueAt,
            phase,
            knownSignals,
            requestedSlots,
            samplesByPlayer,
          },
          tender,
        })
      }

      if (command.type === 'allocate-power') {
        if (tender.phase !== 'power-allocation') {
          throw new TenderFailure('invalid_tender_state', 'Power allocation is closed')
        }
        if (tender.powerAllocations[player.id] !== undefined) {
          throw new TenderFailure('invalid_tender_state', 'Power allocation is already confirmed')
        }
        const currentSampleCount = new Set(tender.samplesByPlayer[player.id] ?? []).size
        const missingSampleCount = signalIds.length - currentSampleCount
        if (command.allocation.reconnaissance > missingSampleCount) {
          throw new TenderFailure('invalid_tender_state', 'Reconnaissance Power exceeds the number of missing Samples')
        }
        if (command.allocation.laboratory > 0 && currentSampleCount + command.allocation.reconnaissance < 2) {
          throw new TenderFailure('invalid_tender_state', 'Laboratory Power requires access to two distinct Samples')
        }
        const powerAllocations: Record<string, PowerAllocation> = { ...tender.powerAllocations, [player.id]: command.allocation }
        const isReadyToStartReconnaissance = activePlayers(tender)
          .every((candidate) => powerAllocations[candidate.id] !== undefined)
        const nextTender = isReadyToStartReconnaissance
          ? beginOperationalActions({ ...tender, powerAllocations })
          : { ...tender, powerAllocations }
        return commitCommand({
          auditEvents: [
            {
              actorId: command.actorId,
              commandId: command.commandId,
              kind: 'power_allocated',
              payload: { allocation: command.allocation, playerId: player.id },
            },
            ...(isReadyToStartReconnaissance
              ? automaticOperationalSkipEvents({ ...tender, powerAllocations }, nextTender)
              : []),
          ],
          command,
          commandFingerprint,
          nextTender: {
            ...nextTender,
            dueAt: deadlineForPhase(nextTender.phase, now()),
          },
          tender,
        })
      }

      if (command.type === 'run-laboratory-test') {
        if (tender.phase !== 'laboratory') {
          throw new TenderFailure('invalid_tender_state', 'Laboratory is closed')
        }
        const expectedPlayer = nextLaboratoryPlayer(tender)
        const samples = tender.samplesByPlayer[player.id] ?? []
        const allocatedPower = tender.powerAllocations[player.id]?.laboratory ?? 0
        const isVersionedCommand = 'laboratory' in command
        if (
          expectedPlayer?.id !== player.id
          || (tender.ruleset === 'tender-v2') !== isVersionedCommand
        ) {
          throw new TenderFailure('invalid_tender_state', 'Laboratory command is not available to this Player')
        }
        const mode = isVersionedCommand
          ? command.laboratory.mode
          : command.protocol === 'continuous' ? 'deep' : 'impulse'
        const pairs = isVersionedCommand
          ? command.laboratory.mode === 'broad'
            ? command.laboratory.pairs
            : [command.laboratory.pair]
          : [{ receiverSignal: command.receiverSignal, sourceSignal: command.sourceSignal }]
        const requiredPower = mode === 'impulse' ? 1 : 2
        if (
          allocatedPower !== requiredPower
          || pairs.some((pair) => (
            !samples.includes(pair.sourceSignal)
            || !samples.includes(pair.receiverSignal)
          ))
        ) {
          throw new TenderFailure('invalid_tender_state', 'Laboratory command is not available to this Player')
        }
        if (pairs.some((pair) => playerAlreadyResearchedPair(tender, player.id, pair))) {
          throw new TenderFailure(
            'laboratory_pair_already_researched',
            'Player already researched this directed Laboratory pair',
          )
        }
        const protocol = mode === 'deep' ? 'continuous' as const : 'impulse' as const
        const resolvedResults = pairs.map((pair) => ({
          playerId: player.id,
          protocol,
          publicResult: resolvePublicResult(
            tender.anomalyConfiguration.signals[pair.sourceSignal],
            tender.anomalyConfiguration.signals[pair.receiverSignal],
          ),
          receiverSignal: pair.receiverSignal,
          sourceSignal: pair.sourceSignal,
        }))
        const publicLaboratoryResults = [
          ...tender.publicLaboratoryResults,
          ...resolvedResults,
        ]
        const publicScientificJournal = [
          ...tender.publicScientificJournal,
          ...resolvedResults.map((result, index) => ({
            ...result,
            testId: `r${tender.round}-t${tender.publicScientificJournal.length + index + 1}`,
          })),
        ]
        const laboratoryCompletedByPlayer = { ...tender.laboratoryCompletedByPlayer, [player.id]: true }
        const measurement = mode === 'deep'
          ? [{
            receiverSignal: pairs[0]!.receiverSignal,
            sourceSignal: pairs[0]!.sourceSignal,
            polarityRelation: tender.anomalyConfiguration.signals[pairs[0]!.sourceSignal].polarity === tender.anomalyConfiguration.signals[pairs[0]!.receiverSignal].polarity
              ? 'same' as const
              : 'different' as const,
          }]
          : []
        const privateMeasurementsByPlayer = measurement.length === 0 ? tender.privateMeasurementsByPlayer : {
          ...tender.privateMeasurementsByPlayer,
          [player.id]: [...(tender.privateMeasurementsByPlayer[player.id] ?? []), ...measurement],
        }
        const nextTender = {
          ...tender,
          laboratoryCompletedByPlayer,
          privateMeasurementsByPlayer,
          publicLaboratoryResults,
          publicScientificJournal,
        }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'laboratory_test_completed',
            payload: {
              mode,
              playerId: player.id,
              protocol,
              results: resolvedResults.map((result) => ({
                publicResult: result.publicResult,
                receiverSignal: result.receiverSignal,
                sourceSignal: result.sourceSignal,
              })),
            },
          }],
          command,
          commandFingerprint,
          nextTender: (() => {
            const advancedTender = nextLaboratoryPlayer(nextTender)
              ? { ...nextTender, phase: 'laboratory' as const }
              : advanceAfterOperationalActions(nextTender, 'laboratory')
            return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) }
          })(),
          tender,
        })
      }

      if (command.type === 'submit-thesis') {
        if (tender.ruleset === 'tender-v2') {
          if (
            tender.phase !== 'model-analysis'
            || (tender.powerAllocations[player.id]?.modelAnalysis ?? 0) === 0
            || tender.modelAnalysisCompletedByPlayer[player.id]
          ) {
            throw new TenderFailure('invalid_tender_state', 'Model analysis is not available to this Player')
          }
          const existingTheses = tender.privateThesesByPlayer[player.id] ?? []
          const roundTheses = existingTheses.filter((thesis) => thesis.round === tender.round)
          const maxTheses = tender.powerAllocations[player.id]?.modelAnalysis ?? 0
          if (roundTheses.length >= maxTheses) {
            throw new TenderFailure('invalid_tender_state', 'Model analysis attempts are exhausted')
          }
          const reviewActive = tender.corporateReviewByPlayer[player.id] ?? false
          if (reviewActive && (tender.budgetByPlayer[player.id] ?? 0) < 1) {
            throw new TenderFailure('invalid_tender_state', 'Model analysis requires one Budget')
          }

          const actual = tender.anomalyConfiguration.signals[command.signalId]
          const fieldTypeCorrect = actual.fieldType === command.fieldType
          const polarityCorrect = actual.polarity === command.polarity
          const fullyCorrect = fieldTypeCorrect && polarityCorrect
          const alreadyCertified = (tender.certifiedSignalsByPlayer[player.id] ?? []).includes(command.signalId)
          const earnsReward = fullyCorrect && !alreadyCertified
          const privateThesis = {
            fieldType: command.fieldType,
            fieldTypeCorrect,
            fullyCorrect,
            id: `r${tender.round}-${player.id}-thesis-${roundTheses.length + 1}`,
            polarity: command.polarity,
            polarityCorrect,
            round: tender.round,
            signalId: command.signalId,
          }
          const privateThesesByPlayer = {
            ...tender.privateThesesByPlayer,
            [player.id]: [...existingTheses, privateThesis],
          }
          const nextRoundThesisCount = roundTheses.length + 1
          const budgetByPlayer = reviewActive
            ? { ...tender.budgetByPlayer, [player.id]: (tender.budgetByPlayer[player.id] ?? 0) - 1 }
            : tender.budgetByPlayer
          const corporateReviewByPlayer = {
            ...tender.corporateReviewByPlayer,
            [player.id]: reviewActive || !fullyCorrect,
          }
          const canSubmitAnother = nextRoundThesisCount < maxTheses
            && (!corporateReviewByPlayer[player.id] || (budgetByPlayer[player.id] ?? 0) >= 1)
          const modelAnalysisCompletedByPlayer = canSubmitAnother
            ? tender.modelAnalysisCompletedByPlayer
            : { ...tender.modelAnalysisCompletedByPlayer, [player.id]: true }
          const nextTender = {
            ...tender,
            budgetByPlayer,
            certifiedSignalsByPlayer: earnsReward
              ? {
                  ...tender.certifiedSignalsByPlayer,
                  [player.id]: [...(tender.certifiedSignalsByPlayer[player.id] ?? []), command.signalId],
                }
              : tender.certifiedSignalsByPlayer,
            corporateReviewByPlayer,
            modelAnalysisCompletedByPlayer,
            privateThesesByPlayer,
            ratingByPlayer: earnsReward
              ? { ...tender.ratingByPlayer, [player.id]: (tender.ratingByPlayer[player.id] ?? 0) + 1 }
              : tender.ratingByPlayer,
            researchCertificationsByPlayer: earnsReward
              ? {
                  ...tender.researchCertificationsByPlayer,
                  [player.id]: [...(tender.researchCertificationsByPlayer[player.id] ?? []), command.signalId],
                }
              : tender.researchCertificationsByPlayer,
          }
          const analysisStillOpen = nextModelAnalysisPlayer(nextTender) !== undefined
          const advancedTender = analysisStillOpen
            ? { ...nextTender, phase: 'model-analysis' as const, dueAt: tender.dueAt }
            : advanceAfterOperationalActions(nextTender, 'model-analysis')
          return commitCommand({
            auditEvents: [{
              actorId: command.actorId,
              commandId: command.commandId,
              kind: 'private_thesis_checked',
              payload: {
                fieldTypeCorrect,
                fullyCorrect,
                playerId: player.id,
                polarityCorrect,
                ratingAward: earnsReward ? 1 : 0,
                signalId: command.signalId,
                thesisId: privateThesis.id,
              },
            }],
            command,
            commandFingerprint,
            nextTender: analysisStillOpen
              ? advancedTender
              : { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) },
            tender,
          })
        }
        if (tender.phase !== 'model-analysis' || nextModelAnalysisPlayer(tender)?.id !== player.id) throw new TenderFailure('invalid_tender_state', 'Model analysis is not available to this Player')
        if (tender.corporateReviewActive && (tender.budgetByPlayer[player.id] ?? 0) < 1) {
          const nextTender = { ...tender, modelAnalysisCompletedByPlayer: { ...tender.modelAnalysisCompletedByPlayer, [player.id]: true } }
          return commitCommand({ auditEvents: [{ actorId: command.actorId, commandId: command.commandId, kind: 'thesis_skipped_corporate_review', payload: { playerId: player.id } }], command, commandFingerprint, nextTender: (() => {
            const advancedTender = nextModelAnalysisPlayer(nextTender) ? { ...nextTender, phase: 'model-analysis' as const } : advanceAfterOperationalActions(nextTender, 'model-analysis')
            return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) }
          })(), tender })
        }
        const actual = tender.anomalyConfiguration.signals[command.signalId]
        const correct = actual.fieldType === command.fieldType && actual.polarity === command.polarity
        const modelAnalysisCompletedByPlayer = { ...tender.modelAnalysisCompletedByPlayer, [player.id]: true }
        const ratingByPlayer = correct
          ? { ...tender.ratingByPlayer, [player.id]: (tender.ratingByPlayer[player.id] ?? 0) + 1 }
          : tender.ratingByPlayer
        const budgetByPlayer = tender.corporateReviewActive
          ? { ...tender.budgetByPlayer, [player.id]: (tender.budgetByPlayer[player.id] ?? 0) - 1 }
          : tender.budgetByPlayer
        const researchCertificationsByPlayer = correct
          ? { ...tender.researchCertificationsByPlayer, [player.id]: [...(tender.researchCertificationsByPlayer[player.id] ?? []), command.signalId] }
          : tender.researchCertificationsByPlayer
        const publicTheses = [
          ...tender.publicTheses,
          {
            correct,
            fieldType: command.fieldType,
            playerId: player.id,
            polarity: command.polarity,
            signalId: command.signalId,
            verification: tender.powerAllocations[player.id]?.modelAnalysis === 2 ? 'extended' as const : 'standard' as const,
          },
        ]
        const nextTender = {
          ...tender,
          budgetByPlayer,
          corporateReviewActive: tender.corporateReviewActive || !correct,
          modelAnalysisCompletedByPlayer,
          publicTheses,
          researchCertificationsByPlayer,
          ratingByPlayer,
        }
        return commitCommand({ auditEvents: [{ actorId: command.actorId, commandId: command.commandId, kind: 'thesis_checked', payload: { correct, playerId: player.id, signalId: command.signalId } }], command, commandFingerprint, nextTender: (() => {
          const advancedTender = nextModelAnalysisPlayer(nextTender)
            ? { ...nextTender, phase: 'model-analysis' as const }
            : advanceAfterOperationalActions(nextTender, 'model-analysis')
          return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) }
        })(), tender })
      }

      if (command.type === 'finish-model-analysis') {
        if (
          tender.ruleset !== 'tender-v2'
          || tender.phase !== 'model-analysis'
          || (tender.powerAllocations[player.id]?.modelAnalysis ?? 0) < 2
          || tender.modelAnalysisCompletedByPlayer[player.id]
          || (tender.privateThesesByPlayer[player.id] ?? []).filter((thesis) => thesis.round === tender.round).length !== 1
        ) {
          throw new TenderFailure('invalid_tender_state', 'Model analysis cannot be finished now')
        }
        const nextTender = {
          ...tender,
          modelAnalysisCompletedByPlayer: {
            ...tender.modelAnalysisCompletedByPlayer,
            [player.id]: true,
          },
        }
        const analysisStillOpen = nextModelAnalysisPlayer(nextTender) !== undefined
        const advancedTender = analysisStillOpen
          ? { ...nextTender, phase: 'model-analysis' as const, dueAt: tender.dueAt }
          : advanceAfterOperationalActions(nextTender, 'model-analysis')
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'model_analysis_finished_early',
            payload: { playerId: player.id },
          }],
          command,
          commandFingerprint,
          nextTender: analysisStillOpen
            ? advancedTender
            : { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) },
          tender,
        })
      }

      if (command.type === 'update-working-model') {
        if (tender.phase === 'complete') {
          throw new TenderFailure('invalid_tender_state', 'Working Model updates are closed')
        }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'working_model_updated',
            payload: { playerId: player.id },
          }],
          command,
          commandFingerprint,
          nextTender: {
            ...tender,
            privateWorkingModelsByPlayer: {
              ...tender.privateWorkingModelsByPlayer,
              [player.id]: command.workingModel,
            },
          },
          tender,
        })
      }

      if (command.type === 'update-scientific-model-draft') {
        if (
          tender.ruleset !== 'tender-v2'
          || tender.phase !== 'final-scientific-model'
          || tender.finalScientificModelCompletedByPlayer[player.id]
        ) {
          throw new TenderFailure('invalid_tender_state', 'Final Scientific Model draft is not available to this Player')
        }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'scientific_model_draft_updated',
            payload: { playerId: player.id },
          }],
          command,
          commandFingerprint,
          nextTender: {
            ...tender,
            finalScientificModelDraftsByPlayer: {
              ...tender.finalScientificModelDraftsByPlayer,
              [player.id]: command.scientificModelDraft,
            },
          },
          tender,
        })
      }

      if (command.type === 'submit-scientific-model') {
        const canSubmit = tender.ruleset === 'tender-v2'
          ? tender.phase === 'final-scientific-model'
            && !tender.finalScientificModelCompletedByPlayer[player.id]
          : tender.phase === 'final-scientific-model'
            && nextScientificModelPlayer(tender)?.id === player.id
        if (!canSubmit) {
          throw new TenderFailure('invalid_tender_state', 'Final Scientific Model is not available to this Player')
        }
        const correctProperties = Object.entries(command.scientificModel.signals).reduce((score, [signalId, claim]) => {
          const actual = tender.anomalyConfiguration.signals[signalId as SignalId]
          return score
            + (claim.fieldType === actual.fieldType ? 1 : 0)
            + (claim.polarity === actual.polarity ? 1 : 0)
        }, 0)
        const correctSignals = signalIds.reduce((score, signalId) => {
          const claim = command.scientificModel.signals[signalId]
          const actual = tender.anomalyConfiguration.signals[signalId]
          return score + Number(claim?.fieldType === actual.fieldType && claim.polarity === actual.polarity)
        }, 0)
        const isCompleteModel = signalIds.every((signalId) => {
          const claim = command.scientificModel.signals[signalId]
          const actual = tender.anomalyConfiguration.signals[signalId]
          return claim?.fieldType === actual.fieldType && claim.polarity === actual.polarity
        })
        const completeModelBonus = isCompleteModel ? completeScientificModelBonus : 0
        const ratingAward = correctProperties + correctSignals + completeModelBonus
        const ratingByPlayer = {
          ...tender.ratingByPlayer,
          [player.id]: (tender.ratingByPlayer[player.id] ?? 0) + ratingAward,
        }
        const nextTender = {
          ...tender,
          finalScientificModelCompletedByPlayer: { ...tender.finalScientificModelCompletedByPlayer, [player.id]: true },
          finalScientificModelDraftsByPlayer: Object.fromEntries(
            Object.entries(tender.finalScientificModelDraftsByPlayer)
              .filter(([playerId]) => playerId !== player.id),
          ),
          finalScientificModelsByPlayer: { ...tender.finalScientificModelsByPlayer, [player.id]: command.scientificModel },
          finalScientificModelSubmittedAtByPlayer: {
            ...tender.finalScientificModelSubmittedAtByPlayer,
            [player.id]: now().toISOString(),
          },
          ratingByPlayer,
        }
        const phase = nextScientificModelPlayer(nextTender) ? 'final-scientific-model' : 'complete'
        const completedTender = phase === 'complete'
          ? {
              ...nextTender,
              finalScientificModelDraftsByPlayer: {},
              winnerPlayerIds: resolveWinners(nextTender),
            }
          : nextTender
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'scientific_model_scored',
            payload: { completeModelBonus, correctProperties, correctSignals, isCompleteModel, playerId: player.id, ratingAward, scientificModel: command.scientificModel },
          }],
          command,
          commandFingerprint,
          nextTender: {
            ...completedTender,
            dueAt: tender.ruleset === 'tender-v2' && phase === 'final-scientific-model'
              ? tender.dueAt
              : deadlineForPhase(phase, now()),
            phase,
          },
          tender,
        })
      }

      if (command.type === 'reserve-contract') {
        if (tender.phase !== 'contracts') {
          throw new TenderFailure('invalid_tender_state', 'Contracts are closed')
        }
        const expectedPlayer = nextContractsPlayer(tender)
        const isFinalContract = command.contractId === finalContractId
        const contract = isFinalContract
          ? tender.publicFinalContract
          : tender.publicContracts.find((candidate) => candidate.contractId === command.contractId)
        const alreadyReservedContract = tender.publicContracts.some((candidate) => candidate.reservedByPlayerId === player.id)
          || tender.publicFinalContract.reservedByPlayerId === player.id
        const canReserveFinalContract = tender.round === 5 && (tender.corporateTrustByPlayer[player.id] ?? 0) >= 2
        if (
          !contract
          || contract.reservedByPlayerId
          || alreadyReservedContract
          || expectedPlayer?.id !== player.id
          || (isFinalContract && !canReserveFinalContract)
          || (tender.ruleset === 'tender-v2'
            && !contractPlanningForPlayer(tender, player.id, contract).eligible)
        ) {
          throw new TenderFailure('invalid_tender_state', 'Contract reservation is not available to this Player')
        }
        const publicContracts = tender.publicContracts.map((candidate) => candidate.contractId === command.contractId
          ? { ...candidate, reservedByPlayerId: player.id }
          : candidate)
        const publicFinalContract = isFinalContract ? { ...tender.publicFinalContract, reservedByPlayerId: player.id } : tender.publicFinalContract
        const nextTender = { ...tender, publicContracts, publicFinalContract }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'contract_reserved',
            payload: { contractId: command.contractId, playerId: player.id },
          }],
          command,
          commandFingerprint,
          nextTender: { ...nextTender, dueAt: tender.dueAt, phase: 'contracts' },
          tender,
        })
      }

      if (command.type === 'skip-contract') {
        if (tender.phase !== 'contracts' || nextContractsPlayer(tender)?.id !== player.id) {
          throw new TenderFailure('invalid_tender_state', 'Contract skip is not available to this Player')
        }
        const candidates = [...tender.publicContracts, tender.publicFinalContract]
        const alreadyReserved = candidates.some((contract) => contract.reservedByPlayerId === player.id)
        if (alreadyReserved || candidates.some((contract) => contractIsEligibleForPlayer(tender, player.id, contract))) {
          throw new TenderFailure('invalid_tender_state', 'An eligible Contract is available to this Player')
        }
        const nextTender = {
          ...tender,
          contractCompletedByPlayer: { ...tender.contractCompletedByPlayer, [player.id]: true },
        }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'contract_skipped_no_eligible_contract',
            payload: { playerId: player.id },
          }],
          command,
          commandFingerprint,
          nextTender: (() => {
            const advancedTender = advanceAfterContracts(nextTender)
            return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) }
          })(),
          tender,
        })
      }

      if (command.type === 'submit-contract-bid') {
        if (tender.phase !== 'contracts') {
          throw new TenderFailure('invalid_tender_state', 'Contracts are closed')
        }
        const expectedPlayer = nextContractsPlayer(tender)
        const isFinalContract = command.contractId === finalContractId
        const contract = isFinalContract
          ? tender.publicFinalContract
          : tender.publicContracts.find((candidate) => candidate.contractId === command.contractId)
        if (!contract || contract.bidOutcome !== undefined || contract.reservedByPlayerId !== player.id || expectedPlayer?.id !== player.id) {
          throw new TenderFailure('invalid_tender_state', 'Contract Bid is not available to this Player')
        }
        const kind = contract.kind ?? (isFinalContract ? 'final' : 'light')
        const evidenceTestIds = command.evidenceTestIds ?? []
        const isAwarded = contractEvidenceSelectionIsEligible(
          tender,
          player.id,
          contract,
          evidenceTestIds,
          command.researchCertificationSignal,
        )
        if (tender.ruleset === 'tender-v2' && !isAwarded) {
          throw new TenderFailure('contract_evidence_stale', 'Selected Contract evidence is no longer suitable')
        }
        const publicContracts = tender.publicContracts.map((candidate) => candidate.contractId === command.contractId
          ? {
            ...candidate,
            ...(isAwarded ? { awardedToPlayerId: player.id } : {}),
            bidOutcome: isAwarded ? 'awarded' as const : 'failed' as const,
          }
          : candidate)
        const publicFinalContract = isFinalContract
          ? {
            ...tender.publicFinalContract,
            ...(isAwarded ? { awardedToPlayerId: player.id } : {}),
            bidOutcome: isAwarded ? 'awarded' as const : 'failed' as const,
          }
          : tender.publicFinalContract
        const corporateTrustByPlayer = isAwarded
          ? { ...tender.corporateTrustByPlayer, [player.id]: (tender.corporateTrustByPlayer[player.id] ?? 0) + (isFinalContract ? 0 : 1) }
          : tender.corporateTrustByPlayer
        const ratingAward = contract.ratingReward ?? (isFinalContract ? finalContractRating : normalContractRating)
        const ratingByPlayer = isAwarded
          ? { ...tender.ratingByPlayer, [player.id]: (tender.ratingByPlayer[player.id] ?? 0) + ratingAward }
          : tender.ratingByPlayer
        const researchCertificationsByPlayer = isAwarded && kind === 'scientific'
          ? {
            ...tender.researchCertificationsByPlayer,
            [player.id]: (tender.researchCertificationsByPlayer[player.id] ?? []).filter((signal) => signal !== contract.targetSignal),
          }
          : tender.researchCertificationsByPlayer
        const usedContractEvidenceTestIds = isAwarded && kind !== 'scientific'
          ? [...tender.usedContractEvidenceTestIds, ...evidenceTestIds]
          : tender.usedContractEvidenceTestIds
        const nextTender = { ...tender, contractCompletedByPlayer: { ...tender.contractCompletedByPlayer, [player.id]: true }, corporateTrustByPlayer, publicContracts, publicFinalContract, ratingByPlayer, researchCertificationsByPlayer, usedContractEvidenceTestIds }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'contract_bid_assessed',
            payload: {
              awarded: isAwarded,
              awardedToPlayerId: isAwarded ? player.id : undefined,
              contractId: command.contractId,
              corporateTrustByPlayer,
              evidenceTestIds,
              playerId: player.id,
              ratingAward: isAwarded ? ratingAward : 0,
              ratingByPlayer,
              researchCertificationSignal: command.researchCertificationSignal,
            },
          }],
          command,
          commandFingerprint,
          nextTender: (() => {
            const advancedTender = advanceAfterContracts(nextTender)
            return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) }
          })(),
          tender,
        })
      }

      if (tender.phase !== 'reconnaissance') {
        throw new TenderFailure('invalid_tender_state', 'Reconnaissance is closed')
      }
      const expectedPlayer = nextReconnaissancePlayer(tender)
      const targets = command.targets ?? command.signals ?? []
      if (expectedPlayer?.id !== player.id || targets.length !== tender.powerAllocations[player.id]?.reconnaissance) {
        throw new TenderFailure('invalid_tender_state', 'Reconnaissance command is not available to this Player')
      }
      const currentSamples = tender.samplesByPlayer[player.id] ?? []
      const knownSignals = [...tender.knownSignals]
      const acquiredSignals: SignalId[] = []
      for (const target of targets) {
        const signal = target === 'unknown-sector'
          ? signalIds.find((signalId) => !knownSignals.includes(signalId))
          : target
        if (!signal || (target !== 'unknown-sector' && (!knownSignals.includes(signal) || currentSamples.includes(signal)))) {
          throw new TenderFailure('invalid_tender_state', 'Reconnaissance target is not available to this Player')
        }
        acquiredSignals.push(signal)
        if (!knownSignals.includes(signal)) knownSignals.push(signal)
      }
      const samplesByPlayer = { ...tender.samplesByPlayer, [player.id]: [...currentSamples, ...acquiredSignals] as SignalId[] }
      const rawTelemetrySignalsByPlayer = {
        ...tender.rawTelemetrySignalsByPlayer,
        [player.id]: [...(tender.rawTelemetrySignalsByPlayer[player.id] ?? []), ...acquiredSignals] as SignalId[],
      }
      const reconnaissanceCompletedByPlayer = { ...tender.reconnaissanceCompletedByPlayer, [player.id]: true }
      const nextTender = {
        ...tender,
        knownSignals,
        rawTelemetrySignalsByPlayer,
        reconnaissanceCompletedByPlayer,
        samplesByPlayer,
      }
      const isReadyForLaboratory = nextReconnaissancePlayer(nextTender) === undefined
      const advancedTender = isReadyForLaboratory
        ? advanceAfterOperationalActions(markImpossibleOperationalActions(nextTender), 'reconnaissance')
        : { ...nextTender, phase: tender.phase }
      return commitCommand({
        auditEvents: [
          {
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'reconnaissance_completed',
            payload: { acquiredSignals, playerId: player.id, targets },
          },
          ...(isReadyForLaboratory ? automaticOperationalSkipEvents(nextTender, advancedTender) : []),
        ],
        command,
        commandFingerprint,
        nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) },
        tender,
      })
    },

    async readTenderPlacement(query: TenderViewQuery): Promise<number | undefined> {
      const parsedQuery = tenderViewQuerySchema.safeParse(query)
      if (!parsedQuery.success) {
        throw new TenderFailure('invalid_tender_view_query', 'Tender view query is invalid')
      }
      const { tenderId, playerId } = parsedQuery.data
      const tender = await readTender(tenderId)
      const player = readPlayer(tender, playerId)
      if (tender.phase !== 'complete') return undefined
      return placementByPlayer(tender)[player.id]
    },

    async readTenderView(query: TenderViewQuery): Promise<TenderView> {
      const parsedQuery = tenderViewQuerySchema.safeParse(query)
      if (!parsedQuery.success) {
        throw new TenderFailure('invalid_tender_view_query', 'Tender view query is invalid')
      }
      const { tenderId, playerId } = parsedQuery.data
      const tender = await readTender(tenderId)
      const player = readPlayer(tender, playerId)
      if (tender.phase !== 'complete' && !isActivePlayer(tender, player.id)) {
        throw new TenderFailure('player_forfeited', 'Player permanently forfeited this Tender')
      }
      const activePlayerId = activePlayerIdForView(tender)
      const auditEvents = tender.phase === 'complete'
        ? await store.readAuditEvents(tenderId)
        : undefined
      const tiePriorities = Object.fromEntries(
        rotateTiePriority(tender.players, tender.round).map((candidate) => [candidate.id, candidate.tiePriority]),
      )
      const modelAnalysisProgress = tender.ruleset === 'tender-v2' && tender.phase === 'model-analysis'
        ? {
            completed: modelAnalysisPlayers(tender).filter((candidate) =>
              tender.modelAnalysisCompletedByPlayer[candidate.id],
            ).length,
            total: modelAnalysisPlayers(tender).length,
          }
        : undefined
      const finalScientificModelProgress = tender.ruleset === 'tender-v2'
        && tender.phase === 'final-scientific-model'
        ? {
            completed: finalScientificModelPlayers(tender).filter((candidate) =>
              tender.finalScientificModelCompletedByPlayer[candidate.id],
            ).length,
            total: finalScientificModelPlayers(tender).length,
          }
        : undefined
      const sequentialPhaseProgress = (() => {
        if (tender.phase === 'reconnaissance') {
          const players = activePlayers(tender).filter((candidate) =>
            (tender.powerAllocations[candidate.id]?.reconnaissance ?? 0) > 0,
          )
          return {
            completed: players.filter((candidate) => tender.reconnaissanceCompletedByPlayer[candidate.id]).length,
            total: players.length,
          }
        }
        if (tender.phase === 'laboratory') {
          const players = activePlayers(tender).filter((candidate) =>
            (tender.powerAllocations[candidate.id]?.laboratory ?? 0) > 0,
          )
          return {
            completed: players.filter((candidate) => tender.laboratoryCompletedByPlayer[candidate.id]).length,
            total: players.length,
          }
        }
        if (tender.phase === 'contracts') {
          const players = activePlayers(tender).filter((candidate) => effectiveContractPower(tender, candidate.id) > 0)
          return {
            completed: players.filter((candidate) => tender.contractCompletedByPlayer[candidate.id]).length,
            total: players.length,
          }
        }
        return undefined
      })()
      const currentRoundPrivateTheses = (candidateId: string) =>
        (tender.privateThesesByPlayer[candidateId] ?? []).filter((thesis) => thesis.round === tender.round)
      const hiddenCurrentRoundRating = (candidateId: string) => {
        const allTheses = tender.privateThesesByPlayer[candidateId] ?? []
        return currentRoundPrivateTheses(candidateId).filter((thesis) => {
          if (!thesis.fullyCorrect) return false
          const thesisIndex = allTheses.findIndex((candidate) => candidate.id === thesis.id)
          return !allTheses.slice(0, thesisIndex).some((candidate) =>
            candidate.fullyCorrect && candidate.signalId === thesis.signalId,
          )
        }).length
      }
      const hiddenCurrentRoundBudget = (candidateId: string) => {
        const theses = currentRoundPrivateTheses(candidateId)
        return theses.length >= 2 && !theses[0]?.fullyCorrect ? 1 : 0
      }
      return {
        ...(activePlayerId ? { activePlayerId } : {}),
        abandonmentDueAt: tender.abandonmentDueAt?.toISOString() ?? null,
        ...(tender.completionReason ? { completionReason: tender.completionReason } : {}),
        knownSignals: tender.knownSignals,
        corporateReviewActive: tender.ruleset === 'tender-v2'
          ? tender.corporateReviewByPlayer[playerId] ?? false
          : tender.corporateReviewActive,
        hasLeft: tender.departedPlayerIds.includes(playerId),
        hasForfeited: !isActivePlayer(tender, playerId),
        publicContracts: tender.publicContracts.map((contract) => ({
          ...contract,
          eligibleForPlayer: contractIsEligibleForPlayer(tender, playerId, contract),
          planning: contractPlanningForPlayer(tender, playerId, contract),
        })),
        publicFinalContract: {
          ...tender.publicFinalContract,
          eligibleForPlayer: contractIsEligibleForPlayer(tender, playerId, tender.publicFinalContract),
          planning: contractPlanningForPlayer(tender, playerId, tender.publicFinalContract),
        },
        publicLaboratoryResults: tender.publicLaboratoryResults,
        publicScientificJournal: tender.publicScientificJournal,
        round: tender.round,
        ruleset: tender.ruleset,
        ...(modelAnalysisProgress ? { modelAnalysisProgress } : {}),
        ...(finalScientificModelProgress ? { finalScientificModelProgress } : {}),
        ...(sequentialPhaseProgress ? { sequentialPhaseProgress } : {}),
        serverTime: now().toISOString(),
        tenderId,
        version: tender.version,
        phase: tender.phase,
        dueAt: tender.dueAt?.toISOString() ?? null,
        players: tender.players.map((player) => ({
          playerId: player.id,
          displayName: player.displayName ?? player.id.slice(0, 8),
          tiePriority: tiePriorities[player.id],
          ...(tender.phase !== 'access-slot-selection' ? { accessSlot: tender.accessSlots[player.id] } : {}),
          ...(!isActivePlayer(tender, player.id) ? { forfeited: true } : {}),
          budget: tender.ruleset === 'tender-v2'
            && tender.phase === 'model-analysis'
            && player.id !== playerId
            ? (tender.budgetByPlayer[player.id] ?? 0) + hiddenCurrentRoundBudget(player.id)
            : tender.budgetByPlayer[player.id] ?? 0,
          corporateTrust: tender.corporateTrustByPlayer[player.id] ?? 0,
          contractPowerRestriction: tender.contractPowerRestrictionsByPlayer[player.id] ?? 0,
          ...(tender.phase === 'final-scientific-model'
            && (tender.ruleset === 'tender-v1' || player.id === playerId)
            ? { finalScientificModelSubmitted: tender.finalScientificModelsByPlayer[player.id] !== undefined }
            : {}),
          ...(tender.ruleset === 'tender-v2' && tender.phase === 'model-analysis' && player.id === playerId
            ? { modelAnalysisCompleted: tender.modelAnalysisCompletedByPlayer[player.id] ?? false }
            : {}),
          ...(tender.phase === 'power-allocation'
            ? { powerAllocationConfirmed: tender.powerAllocations[player.id] !== undefined }
            : {}),
          ...(tender.phase !== 'access-slot-selection'
            && tender.powerAllocations[player.id]
            && (tender.phase !== 'power-allocation' || player.id === playerId)
            ? { powerAllocation: tender.powerAllocations[player.id] }
            : {}),
          rating: tender.ruleset === 'tender-v2'
            && tender.phase === 'model-analysis'
            && player.id !== playerId
            ? Math.max(0, (tender.ratingByPlayer[player.id] ?? 0) - hiddenCurrentRoundRating(player.id))
            : tender.ratingByPlayer[player.id] ?? 0,
          ...(player.id === playerId && tender.requestedSlots[player.id] !== undefined
            ? { requestedAccessSlot: tender.requestedSlots[player.id] }
            : {}),
        })),
        privateRawTelemetrySignals: tender.rawTelemetrySignalsByPlayer[player.id] ?? [],
        privateSamples: tender.samplesByPlayer[player.id] ?? [],
        privateMeasurements: tender.privateMeasurementsByPlayer[player.id] ?? [],
        ...(tender.automaticOperationalSkipsByPlayer[player.id]?.round === tender.round
          ? { privateAutomaticOperationalSkip: tender.automaticOperationalSkipsByPlayer[player.id] }
          : {}),
        ...(tender.ruleset === 'tender-v2'
          && tender.phase === 'final-scientific-model'
          && !tender.finalScientificModelCompletedByPlayer[player.id]
          ? {
              privateFinalScientificModelDraft: tender.finalScientificModelDraftsByPlayer[player.id] ?? { signals: {} },
            }
          : {}),
        ...(tender.phase === 'final-scientific-model'
          && tender.finalScientificModelsByPlayer[player.id]
          && tender.finalScientificModelSubmittedAtByPlayer[player.id]
          ? {
              privateFinalScientificModelSubmission: {
                scientificModel: tender.finalScientificModelsByPlayer[player.id],
                submittedAt: tender.finalScientificModelSubmittedAtByPlayer[player.id],
              },
            }
          : {}),
        privateTheses: tender.ruleset === 'tender-v2'
          ? tender.privateThesesByPlayer[player.id] ?? []
          : undefined,
        privateResearchCertifications: tender.researchCertificationsByPlayer[player.id] ?? [],
        privateTelemetry: tender.privateMeasurementsByPlayer[player.id] ?? [],
        privateUsedContractEvidenceTestIds: tender.usedContractEvidenceTestIds.filter((testId) =>
          tender.publicScientificJournal.some((entry) => entry.testId === testId && entry.playerId === playerId),
        ),
        privateWorkingModel: tender.privateWorkingModelsByPlayer[player.id] ?? { signals: {} },
        publicTheses: tender.ruleset === 'tender-v2' ? [] : tender.publicTheses,
        ...(tender.phase === 'complete' ? { winnerPlayerIds: tender.winnerPlayerIds } : {}),
        ...(tender.phase === 'complete' ? {
          audit: {
            anomalyConfiguration: tender.anomalyConfiguration,
            completionReason: tender.completionReason ?? 'standard',
            finalScientificModelsByPlayer: finalScientificModelAuditByPlayer(tender),
            forfeitedAtByPlayer: tender.forfeitedAtByPlayer,
            placementByPlayer: placementByPlayer(tender),
            privateThesesByPlayer: tender.privateThesesByPlayer,
            privateMeasurementsByPlayer: tender.privateMeasurementsByPlayer,
            privateTelemetryByPlayer: tender.privateMeasurementsByPlayer,
            publicLaboratoryResults: tender.publicLaboratoryResults,
            publicScientificJournal: tender.publicScientificJournal,
            ratingBreakdownByPlayer: createRatingBreakdownByPlayer(tender, auditEvents!),
            rounds: createParticipantAuditRounds(tender, auditEvents!),
            ruleset: tender.ruleset,
          },
        } : {}),
      }
    },

    async advanceDueTenders({ limit, now: dueNow }: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult> {
      const advancedTenderIds: string[] = []
      for (const tenderId of await store.findDue({ limit, now: dueNow })) {
        const tender = await store.read(tenderId)
        if (!tender) continue
        const abandonmentIsDue = tender.abandonmentDueAt !== null
          && tender.abandonmentDueAt <= dueNow
          && tender.departedPlayerIds.length === tender.players.length
          && tender.phase !== 'complete'
        if (abandonmentIsDue) {
          const completed = await commitTimeout({
            auditEvents: [{
              kind: 'tender_abandoned',
              payload: {
                completionReason: 'all_players_left',
                playerIds: tender.players.map((player) => player.id),
              },
            }],
            nextTender: {
              ...tender,
              abandonmentDueAt: null,
              completionReason: 'all_players_left',
              dueAt: null,
              phase: 'complete',
              winnerPlayerIds: [],
            },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.dueAt === null || tender.dueAt > dueNow) continue

        if (tender.phase === 'power-allocation') {
          const timedOutPlayerIds = activePlayers(tender)
            .filter((player) => tender.powerAllocations[player.id] === undefined)
            .map((player) => player.id)
          if (timedOutPlayerIds.length === 0) continue
          const powerAllocations = {
            ...tender.powerAllocations,
            ...Object.fromEntries(timedOutPlayerIds.map((playerId) => [playerId, reservePowerAllocation])),
          }
          const nextTender = beginOperationalActions({ ...tender, powerAllocations })
          const completed = await commitTimeout({
            auditEvents: [
              {
                kind: 'power_allocation_timeout_resolved',
                payload: {
                  timedOutPlayerIds,
                },
              },
              ...automaticOperationalSkipEvents({ ...tender, powerAllocations }, nextTender),
            ],
            nextTender: { ...nextTender, dueAt: deadlineForPhase(nextTender.phase, dueNow) },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase === 'reconnaissance') {
          const expectedPlayer = nextReconnaissancePlayer(tender)
          if (!expectedPlayer) continue
          const nextTender = {
            ...tender,
            reconnaissanceCompletedByPlayer: { ...tender.reconnaissanceCompletedByPlayer, [expectedPlayer.id]: true },
          }
          const advancedTender = nextReconnaissancePlayer(nextTender)
            ? { ...nextTender, phase: 'reconnaissance' as const }
            : advanceAfterOperationalActions(markImpossibleOperationalActions(nextTender), 'reconnaissance')
          const completed = await commitTimeout({
            auditEvents: [
              {
                kind: 'operational_action_timeout_resolved',
                payload: { phase: tender.phase, playerId: expectedPlayer.id },
              },
              ...automaticOperationalSkipEvents(nextTender, advancedTender),
            ],
            nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, dueNow) },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase === 'laboratory') {
          const expectedPlayer = nextLaboratoryPlayer(tender)
          if (!expectedPlayer) continue
          const nextTender = {
            ...tender,
            laboratoryCompletedByPlayer: { ...tender.laboratoryCompletedByPlayer, [expectedPlayer.id]: true },
          }
          const advancedTender = nextLaboratoryPlayer(nextTender)
            ? { ...nextTender, phase: 'laboratory' as const }
            : advanceAfterOperationalActions(nextTender, 'laboratory')
          const completed = await commitTimeout({
            auditEvents: [{ kind: 'operational_action_timeout_resolved', payload: { phase: tender.phase, playerId: expectedPlayer.id } }],
            nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, dueNow) },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase === 'model-analysis') {
          if (tender.ruleset === 'tender-v2') {
            const timedOutPlayerIds = modelAnalysisPlayers(tender)
              .filter((player) => !tender.modelAnalysisCompletedByPlayer[player.id])
              .map((player) => player.id)
            const modelAnalysisCompletedByPlayer = {
              ...tender.modelAnalysisCompletedByPlayer,
              ...Object.fromEntries(timedOutPlayerIds.map((playerId) => [playerId, true])),
            }
            const advancedTender = advanceAfterOperationalActions({
              ...tender,
              modelAnalysisCompletedByPlayer,
            }, 'model-analysis')
            const completed = await commitTimeout({
              auditEvents: [{
                kind: 'model_analysis_timeout_resolved',
                payload: { timedOutPlayerIds },
              }],
              nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, dueNow) },
              tender,
            })
            if (completed) advancedTenderIds.push(tenderId)
            continue
          }
          const expectedPlayer = nextModelAnalysisPlayer(tender)
          if (!expectedPlayer) continue
          const nextTender = {
            ...tender,
            modelAnalysisCompletedByPlayer: { ...tender.modelAnalysisCompletedByPlayer, [expectedPlayer.id]: true },
          }
          const advancedTender = nextModelAnalysisPlayer(nextTender)
            ? { ...nextTender, phase: 'model-analysis' as const }
            : advanceAfterOperationalActions(nextTender, 'model-analysis')
          const completed = await commitTimeout({
            auditEvents: [{ kind: 'operational_action_timeout_resolved', payload: { phase: tender.phase, playerId: expectedPlayer.id } }],
            nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, dueNow) },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase === 'contracts') {
          const expectedPlayer = nextContractsPlayer(tender)
          if (!expectedPlayer) continue
          const reservedContract = [...tender.publicContracts, tender.publicFinalContract]
            .find((contract) => contract.reservedByPlayerId === expectedPlayer.id)
          const publicContracts = tender.publicContracts.map((contract) =>
            contract.reservedByPlayerId === expectedPlayer.id
              ? Object.fromEntries(Object.entries(contract).filter(([key]) => key !== 'reservedByPlayerId'))
              : contract,
          ) as StoredTender['publicContracts']
          const publicFinalContract = tender.publicFinalContract.reservedByPlayerId === expectedPlayer.id
            ? Object.fromEntries(
                Object.entries(tender.publicFinalContract).filter(([key]) => key !== 'reservedByPlayerId'),
              ) as StoredTender['publicFinalContract']
            : tender.publicFinalContract
          const nextTender = {
            ...tender,
            contractCompletedByPlayer: { ...tender.contractCompletedByPlayer, [expectedPlayer.id]: true },
            publicContracts,
            publicFinalContract,
          }
          const advancedTender = advanceAfterContracts(nextTender)
          const auditEvent: PendingTenderAuditEvent = reservedContract
            ? {
                kind: 'contract_reservation_timeout_released',
                payload: {
                  contractId: reservedContract.contractId,
                  phase: 'contracts',
                  playerId: expectedPlayer.id,
                },
              }
            : {
                kind: 'operational_action_timeout_resolved',
                payload: { phase: tender.phase, playerId: expectedPlayer.id },
              }
          const completed = await commitTimeout({
            auditEvents: [auditEvent],
            nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, dueNow) },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase === 'final-scientific-model') {
          if (tender.ruleset === 'tender-v2') {
            const timedOutPlayerIds = finalScientificModelPlayers(tender)
              .filter((player) => !tender.finalScientificModelCompletedByPlayer[player.id])
              .map((player) => player.id)
            const finalScientificModelCompletedByPlayer = {
              ...tender.finalScientificModelCompletedByPlayer,
              ...Object.fromEntries(timedOutPlayerIds.map((playerId) => [playerId, true])),
            }
            const completedTender = {
              ...tender,
              finalScientificModelCompletedByPlayer,
              finalScientificModelDraftsByPlayer: {},
            }
            const completed = await commitTimeout({
              auditEvents: [{
                kind: 'final_scientific_model_timeout_resolved',
                payload: { timedOutPlayerIds },
              }],
              nextTender: {
                ...completedTender,
                dueAt: null,
                phase: 'complete',
                winnerPlayerIds: resolveWinners(completedTender),
              },
              tender,
            })
            if (completed) advancedTenderIds.push(tenderId)
            continue
          }
          const expectedPlayer = nextScientificModelPlayer(tender)
          if (!expectedPlayer) continue
          const nextTender = {
            ...tender,
            finalScientificModelCompletedByPlayer: { ...tender.finalScientificModelCompletedByPlayer, [expectedPlayer.id]: true },
          }
          const phase = nextScientificModelPlayer(nextTender) ? 'final-scientific-model' : 'complete'
          const completedTender = phase === 'complete'
            ? { ...nextTender, winnerPlayerIds: resolveWinners(nextTender) }
            : nextTender
          const completed = await commitTimeout({
            auditEvents: [{ kind: 'operational_action_timeout_resolved', payload: { phase: tender.phase, playerId: expectedPlayer.id } }],
            nextTender: { ...completedTender, dueAt: deadlineForPhase(phase, dueNow), phase },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase !== 'access-slot-selection') continue

        const currentActivePlayers = activePlayers(tender)
        const timedOutPlayers = currentActivePlayers.filter((player) => tender.requestedSlots[player.id] === undefined)
        const requestedSlots = {
          ...tender.requestedSlots,
          ...Object.fromEntries(timedOutPlayers.map((player) => [player.id, 3])),
        }
        const accessSlots = resolveAccessSlots(rotateTiePriority(currentActivePlayers, tender.round), requestedSlots)
        const timedOutPlayerIds = new Set(timedOutPlayers.map((player) => player.id))
        const budgetByPlayer = {
          ...tender.budgetByPlayer,
          ...Object.fromEntries(currentActivePlayers.map((player) => [
            player.id,
            timedOutPlayerIds.has(player.id)
              ? tender.budgetByPlayer[player.id] ?? 0
              : (tender.budgetByPlayer[player.id] ?? 0) + accessSlotBudgetDelta(accessSlots[player.id] ?? 3),
          ])),
        }
        const samplesByPlayer = { ...tender.samplesByPlayer }
        const rawTelemetrySignalsByPlayer = { ...tender.rawTelemetrySignalsByPlayer }
        const knownSignals = [...tender.knownSignals]
        const sampleCompensationByPlayer: Record<string, SignalId> = {}
        for (const player of currentActivePlayers) {
          if (timedOutPlayerIds.has(player.id) || !receivesAccessSlotSampleCompensation(accessSlots[player.id] ?? 3)) continue
          const nextSample = nextCompensationSample(knownSignals, samplesByPlayer[player.id] ?? [])
          if (!nextSample) continue
          sampleCompensationByPlayer[player.id] = nextSample
          samplesByPlayer[player.id] = [...(samplesByPlayer[player.id] ?? []), nextSample]
          if (!knownSignals.includes(nextSample)) knownSignals.push(nextSample)
        }
        const completed = await commitTimeout({
          auditEvents: [{
            kind: 'access_slot_timeout_resolved',
            payload: { accessSlots, budgetByPlayer, sampleCompensationByPlayer, timedOutPlayerIds: [...timedOutPlayerIds] },
          }],
          nextTender: {
            ...tender,
            accessSlots,
            budgetByPlayer,
            dueAt: deadlineForPhase('power-allocation', dueNow),
            phase: 'power-allocation',
            knownSignals,
            requestedSlots,
            samplesByPlayer,
          },
          tender,
        })
        if (completed) advancedTenderIds.push(tenderId)
      }
      return { advancedTenderIds }
    },
  }
}

export function createPersistentTenderModule(db: DbClient) {
  return createTenderModule({ store: createPrismaTenderStore(db) })
}

export type TenderModule = ReturnType<typeof createTenderModule>

export { createTenderRoutes } from './transport/routes'
export { createRealtimeTicketRoutes } from './realtime/ticket-routes'
export { createRealtimeHub, type RealtimeHub } from './realtime/hub'
export { createPrismaRealtimeTicketIssuer } from './realtime/prisma-realtime-ticket-issuer'
export { createPrismaRealtimeTicketStore } from './realtime/prisma-realtime-ticket-store'
export { createPrismaTenderStore } from './infrastructure/prisma-tender-store'
export {
  createRealtimeWebSocketHandlers,
  upgradeRealtimeWebSocket,
  type RealtimeSocketData,
} from './realtime/websocket'
import { randomUUID } from 'node:crypto'
