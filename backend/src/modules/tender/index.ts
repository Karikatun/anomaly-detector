import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  PowerAllocation,
  RatingBreakdown,
  ScientificModel,
  TenderAuditEvent,
  TenderCommand,
  TenderPlayer,
  TenderView,
  TenderViewQuery,
} from '@anomaly-detector/contracts'
import { createTenderSchema, tenderCommandSchema, tenderViewQuerySchema } from '@anomaly-detector/contracts'
import type { StoredTender, TenderStore } from './application/tender-store'
import type { DbClient } from '../../db'
import { resolveAccessSlots } from './domain/access-slots'
import { createAnomalyConfiguration, resolvePublicResult, signalIds, type SignalId } from './domain/anomaly-configuration'
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
  events: TenderAuditEvent[],
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
    const playerId = typeof event.payload.playerId === 'string' ? event.payload.playerId : undefined
    if (!playerId) continue
    const breakdown = breakdownByPlayer[playerId]
    if (!breakdown) continue

    if (event.kind === 'thesis_checked' && event.payload.correct === true) {
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

const deckOffset = (seed: string) => [...seed].reduce((total, character) => (total * 31 + character.charCodeAt(0)) % 1_000_003, 0)

const createRoundContracts = (round: number, playerCount: number, seed: string) => {
  // Round one is the published onboarding deck. Later rounds rotate from the Tender
  // seed, so the complete five-round deck is reproducible without depending on play.
  const offset = (round - 1) * (playerCount + 1 + deckOffset(seed))
  const publicResults = ['reflection', 'attenuation', 'transmission_gain', 'unstable_collapse'] as const
  return Array.from(
  { length: playerCount + 1 },
  (_, index) => ({
    contractId: `round-${round}-contract-${index + 1}`,
    requiredPublicResult: publicResults[(offset + index) % publicResults.length],
    requiredSecondaryPublicResult: publicResults[(offset + index + 1) % publicResults.length],
    targetSignal: signalIds[(offset + index) % signalIds.length],
    kind: index === 0 ? 'scientific' as const : index === 1 ? 'complex' as const : 'light' as const,
    ratingReward: index === 0 ? 3 : index === 1 ? 4 : 2,
    targetRole: (offset + index) % 2 === 0 ? 'source' as const : 'receiver' as const,
  }),
  )
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

const rotateTiePriority = (players: TenderPlayer[], round: number) => {
  const playerCount = players.length
  const offset = (round - 1) % playerCount
  return players.map((player) => ({
    ...player,
    tiePriority: ((player.tiePriority - 1 - offset + playerCount) % playerCount) + 1,
  }))
}

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

  const nextReconnaissancePlayer = (tender: StoredTender) => tender.players
    .filter((player) => tender.powerAllocations[player.id]?.reconnaissance > 0 && !tender.reconnaissanceCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextLaboratoryPlayer = (tender: StoredTender) => tender.players
    .filter((player) => tender.powerAllocations[player.id]?.laboratory > 0 && !tender.laboratoryCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]
  const nextModelAnalysisPlayer = (tender: StoredTender) => tender.players.filter((player) => tender.powerAllocations[player.id]?.modelAnalysis > 0 && !tender.modelAnalysisCompletedByPlayer[player.id]).sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const effectiveContractPower = (tender: StoredTender, playerId: string) => tender.powerAllocations[playerId]?.contracts ?? 0

  const nextContractsPlayer = (tender: StoredTender) => tender.players
    .filter((player) => effectiveContractPower(tender, player.id) > 0)
    .filter((player) => !tender.contractCompletedByPlayer[player.id])
    .filter((player) => tender.publicContracts.every((contract) => contract.reservedByPlayerId !== player.id || contract.bidOutcome === undefined))
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextScientificModelPlayer = (tender: StoredTender) => tender.players
    .filter((player) => !tender.finalScientificModelCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const contractIsEligibleForPlayer = (
    tender: StoredTender,
    playerId: string,
    contract: StoredTender['publicContracts'][number],
  ) => {
    if (contract.reservedByPlayerId || contract.bidOutcome !== undefined) return false
    const isFinal = contract.contractId === finalContractId || contract.kind === 'final'
    const kind = contract.kind ?? (isFinal ? 'final' : 'light')
    if (isFinal && (tender.round !== 5 || (tender.corporateTrustByPlayer[playerId] ?? 0) < 2)) return false
    if (kind === 'scientific') {
      return (tender.researchCertificationsByPlayer[playerId] ?? []).includes(contract.targetSignal!)
    }
    const role = contract.targetRole ?? 'source'
    const availableEvidence = tender.publicScientificJournal.filter((entry) =>
      entry.playerId === playerId
      && !tender.usedContractEvidenceTestIds.includes(entry.testId)
      && entry[role === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal,
    )
    const matchesPrimary = (entry: (typeof availableEvidence)[number]) =>
      entry.publicResult === contract.requiredPublicResult
    if (kind === 'light') return availableEvidence.some(matchesPrimary)
    const secondary = contract.requiredSecondaryPublicResult
      ?? (contract.requiredPublicResult === 'reflection' ? 'attenuation' : 'reflection')
    return availableEvidence.some((entry) => entry.protocol === 'continuous' && matchesPrimary(entry))
      || availableEvidence.some(matchesPrimary)
        && availableEvidence.some((entry) => entry.publicResult === secondary)
  }

  const activePlayerIdForView = (tender: StoredTender) => {
    switch (tender.phase) {
      case 'reconnaissance': return nextReconnaissancePlayer(tender)?.id
      case 'laboratory': return nextLaboratoryPlayer(tender)?.id
      case 'model-analysis': return nextModelAnalysisPlayer(tender)?.id
      case 'contracts': return nextContractsPlayer(tender)?.id
      case 'final-scientific-model': return nextScientificModelPlayer(tender)?.id
      default: return undefined
    }
  }

  const resolveWinners = (tender: StoredTender) => {
    const highestRating = Math.max(...tender.players.map((player) => tender.ratingByPlayer[player.id] ?? 0))
    const ratingLeaders = tender.players.filter((player) => (tender.ratingByPlayer[player.id] ?? 0) === highestRating)
    const correctThesisCount = (playerId: string) => tender.publicTheses.filter((thesis) => thesis.playerId === playerId && thesis.correct).length
    const highestThesisCount = Math.max(...ratingLeaders.map((player) => correctThesisCount(player.id)))
    const thesisLeaders = ratingLeaders.filter((player) => correctThesisCount(player.id) === highestThesisCount)
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
    if (tender.round >= 5) return { ...tenderAfterGrant, phase: 'final-scientific-model' }
    const round = tender.round + 1
    const publicContracts = createRoundContracts(round, tender.players.length, tender.anomalyConfiguration.seed)
    return {
      ...tenderAfterGrant,
      accessSlots: {},
      contractCompletedByPlayer: {},
      corporateReviewActive: false,
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

  const beginOperationalActions = (tender: StoredTender): StoredTender => nextReconnaissancePlayer(tender)
    ? { ...tender, phase: 'reconnaissance' }
    : advanceAfterOperationalActions(tender, 'reconnaissance')

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
        budgetByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 2])),
        corporateTrustByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 0])),
        corporateReviewActive: false,
        contractCompletedByPlayer: {},
        contractPowerRestrictionsByPlayer: {},
        departedPlayerIds: [],
        dueAt: deadlineForPhase('access-slot-selection', now()),
        finalScientificModelCompletedByPlayer: {},
        finalScientificModelsByPlayer: {},
        knownSignals: [...new Set([...publicContracts.map((contract) => contract.targetSignal), publicFinalContract.targetSignal])],
        powerAllocations: {},
        publicContracts,
        publicFinalContract,
        publicLaboratoryResults: [],
        publicScientificJournal: [],
        publicTheses: [],
        ratingByPlayer: {},
        round: 1,
        rawTelemetrySignalsByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, []])),
        reconnaissanceCompletedByPlayer: {},
        laboratoryCompletedByPlayer: {},
        modelAnalysisCompletedByPlayer: {},
        privateMeasurementsByPlayer: {},
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
      const commandFingerprint = fingerprint(command)
      const previousCommand = tender.processedCommands[command.commandId]
      if (previousCommand) {
        if (previousCommand.fingerprint !== commandFingerprint) {
          throw new TenderFailure('duplicate_command_conflict', `Command ${command.commandId} conflicts with its first use`)
        }
        return previousCommand.receipt
      }
      const player = readPlayer(tender, command.actorId)
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
      if (command.type === 'request-access-slot') {
        if (tender.phase !== 'access-slot-selection') {
          throw new TenderFailure('invalid_tender_state', 'Access Slot selection is closed')
        }
        const requestedSlots = { ...tender.requestedSlots, [player.id]: command.slot }
        const isReadyToResolve = Object.keys(requestedSlots).length === tender.players.length
        const accessSlots = isReadyToResolve ? resolveAccessSlots(rotateTiePriority(tender.players, tender.round), requestedSlots) : tender.accessSlots
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
          for (const player of tender.players) {
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
            }] : []),
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
        const isReadyToStartReconnaissance = Object.keys(powerAllocations).length === tender.players.length
        const nextTender = isReadyToStartReconnaissance
          ? beginOperationalActions({ ...tender, powerAllocations })
          : { ...tender, powerAllocations }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'power_allocated',
            payload: { allocation: command.allocation, playerId: player.id },
          }],
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
        const expectedProtocol = tender.powerAllocations[player.id]?.laboratory === 2 ? 'continuous' : 'impulse'
        if (expectedPlayer?.id !== player.id || command.protocol !== expectedProtocol || !samples.includes(command.sourceSignal) || !samples.includes(command.receiverSignal)) {
          throw new TenderFailure('invalid_tender_state', 'Laboratory command is not available to this Player')
        }
        const publicResult = resolvePublicResult(
          tender.anomalyConfiguration.signals[command.sourceSignal],
          tender.anomalyConfiguration.signals[command.receiverSignal],
        )
        const publicLaboratoryResults = [
          ...tender.publicLaboratoryResults,
          {
            playerId: player.id,
            protocol: command.protocol,
            publicResult,
            receiverSignal: command.receiverSignal,
            sourceSignal: command.sourceSignal,
          },
        ]
        const publicScientificJournal = [
          ...tender.publicScientificJournal,
          { ...publicLaboratoryResults.at(-1)!, testId: `r${tender.round}-t${tender.publicScientificJournal.length + 1}` },
        ]
        const laboratoryCompletedByPlayer = { ...tender.laboratoryCompletedByPlayer, [player.id]: true }
        const measurement = command.protocol === 'continuous'
          ? [{
            receiverSignal: command.receiverSignal,
            sourceSignal: command.sourceSignal,
            polarityRelation: tender.anomalyConfiguration.signals[command.sourceSignal].polarity === tender.anomalyConfiguration.signals[command.receiverSignal].polarity
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
            payload: { playerId: player.id, protocol: command.protocol, publicResult, receiverSignal: command.receiverSignal, sourceSignal: command.sourceSignal },
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

      if (command.type === 'update-working-model') {
        if (tender.phase === 'complete') {
          throw new TenderFailure('invalid_tender_state', 'Working Model updates are closed')
        }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'working_model_updated',
            payload: { playerId: player.id, workingModel: command.workingModel },
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

      if (command.type === 'submit-scientific-model') {
        if (tender.phase !== 'final-scientific-model' || nextScientificModelPlayer(tender)?.id !== player.id) {
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
          finalScientificModelsByPlayer: { ...tender.finalScientificModelsByPlayer, [player.id]: command.scientificModel },
          ratingByPlayer,
        }
        const phase = nextScientificModelPlayer(nextTender) ? 'final-scientific-model' : 'complete'
        const completedTender = phase === 'complete'
          ? { ...nextTender, winnerPlayerIds: resolveWinners(nextTender) }
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
          nextTender: { ...completedTender, dueAt: deadlineForPhase(phase, now()), phase },
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
        const targetRole = contract.targetRole ?? 'source'
        const requiredSecondaryPublicResult = contract.requiredSecondaryPublicResult
          ?? (contract.requiredPublicResult === 'reflection' ? 'attenuation' : 'reflection')
        const evidenceTestIds = command.evidenceTestIds ?? []
        const evidence = evidenceTestIds.map((testId) => tender.publicScientificJournal.find((entry) => entry.testId === testId))
        const hasDistinctExistingEvidence = evidence.length === new Set(evidenceTestIds).size && evidence.every((entry) => entry !== undefined)
        const matchesEvidence = (entry: (typeof tender.publicScientificJournal)[number] | undefined) => Boolean(
          entry
          && entry.playerId === player.id
          && !tender.usedContractEvidenceTestIds.includes(entry.testId)
          && entry.publicResult === contract.requiredPublicResult
          && entry[targetRole === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal,
        )
        const matchesTargetRole = (entry: (typeof tender.publicScientificJournal)[number] | undefined) => Boolean(
          entry
          && entry.playerId === player.id
          && !tender.usedContractEvidenceTestIds.includes(entry.testId)
          && entry[targetRole === 'source' ? 'sourceSignal' : 'receiverSignal'] === contract.targetSignal,
        )
        const hasLightEvidence = hasDistinctExistingEvidence && evidence.length === 1 && matchesEvidence(evidence[0])
        const hasComplexEvidence = hasDistinctExistingEvidence && (
          (evidence.length === 1 && evidence[0]?.protocol === 'continuous' && matchesEvidence(evidence[0]))
          || (evidence.length === 2
            && evidence.every(matchesTargetRole)
            && new Set(evidence.map((entry) => entry?.publicResult)).size === 2
            && evidence.some((entry) => entry?.publicResult === contract.requiredPublicResult)
            && evidence.some((entry) => entry?.publicResult === requiredSecondaryPublicResult))
        )
        const hasScientificCertification = command.researchCertificationSignal === contract.targetSignal
          && (tender.researchCertificationsByPlayer[player.id] ?? []).includes(contract.targetSignal!)
        const isAwarded = kind === 'scientific'
          ? evidence.length === 0 && hasScientificCertification
          : kind === 'light'
            ? hasLightEvidence
            : hasComplexEvidence
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
      return commitCommand({
        auditEvents: [{
          actorId: command.actorId,
          commandId: command.commandId,
          kind: 'reconnaissance_completed',
          payload: { acquiredSignals, playerId: player.id, targets },
        }],
        command,
        commandFingerprint,
        nextTender: (() => {
          const advancedTender = isReadyForLaboratory
            ? advanceAfterOperationalActions(nextTender, 'reconnaissance')
            : { ...nextTender, phase: tender.phase }
          return { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, now()) }
        })(),
        tender,
      })
    },

    async readTenderView(query: TenderViewQuery): Promise<TenderView> {
      const parsedQuery = tenderViewQuerySchema.safeParse(query)
      if (!parsedQuery.success) {
        throw new TenderFailure('invalid_tender_view_query', 'Tender view query is invalid')
      }
      const { tenderId, playerId } = parsedQuery.data
      const tender = await readTender(tenderId)
      const player = readPlayer(tender, playerId)
      const activePlayerId = activePlayerIdForView(tender)
      const auditEvents = tender.phase === 'complete'
        ? await store.readAuditEvents(tenderId)
        : undefined
      const tiePriorities = Object.fromEntries(
        rotateTiePriority(tender.players, tender.round).map((candidate) => [candidate.id, candidate.tiePriority]),
      )
      return {
        ...(activePlayerId ? { activePlayerId } : {}),
        abandonmentDueAt: tender.abandonmentDueAt?.toISOString() ?? null,
        ...(tender.completionReason ? { completionReason: tender.completionReason } : {}),
        knownSignals: tender.knownSignals,
        corporateReviewActive: tender.corporateReviewActive,
        hasLeft: tender.departedPlayerIds.includes(playerId),
        publicContracts: tender.publicContracts.map((contract) => ({
          ...contract,
          eligibleForPlayer: contractIsEligibleForPlayer(tender, playerId, contract),
        })),
        publicFinalContract: {
          ...tender.publicFinalContract,
          eligibleForPlayer: contractIsEligibleForPlayer(tender, playerId, tender.publicFinalContract),
        },
        publicLaboratoryResults: tender.publicLaboratoryResults,
        publicScientificJournal: tender.publicScientificJournal,
        round: tender.round,
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
          budget: tender.budgetByPlayer[player.id] ?? 0,
          corporateTrust: tender.corporateTrustByPlayer[player.id] ?? 0,
          contractPowerRestriction: tender.contractPowerRestrictionsByPlayer[player.id] ?? 0,
          ...(tender.phase === 'final-scientific-model'
            ? { finalScientificModelSubmitted: tender.finalScientificModelsByPlayer[player.id] !== undefined }
            : {}),
          ...(tender.phase === 'power-allocation'
            ? { powerAllocationConfirmed: tender.powerAllocations[player.id] !== undefined }
            : {}),
          ...(tender.phase !== 'access-slot-selection'
            && tender.powerAllocations[player.id]
            && (tender.phase !== 'power-allocation' || player.id === playerId)
            ? { powerAllocation: tender.powerAllocations[player.id] }
            : {}),
          rating: tender.ratingByPlayer[player.id] ?? 0,
          ...(player.id === playerId && tender.requestedSlots[player.id] !== undefined
            ? { requestedAccessSlot: tender.requestedSlots[player.id] }
            : {}),
        })),
        privateRawTelemetrySignals: tender.rawTelemetrySignalsByPlayer[player.id] ?? [],
        privateSamples: tender.samplesByPlayer[player.id] ?? [],
        privateMeasurements: tender.privateMeasurementsByPlayer[player.id] ?? [],
        privateResearchCertifications: tender.researchCertificationsByPlayer[player.id] ?? [],
        privateTelemetry: tender.privateMeasurementsByPlayer[player.id] ?? [],
        privateUsedContractEvidenceTestIds: tender.usedContractEvidenceTestIds.filter((testId) =>
          tender.publicScientificJournal.some((entry) => entry.testId === testId && entry.playerId === playerId),
        ),
        privateWorkingModel: tender.privateWorkingModelsByPlayer[player.id] ?? { signals: {} },
        publicTheses: tender.publicTheses,
        ...(tender.phase === 'complete' ? { winnerPlayerIds: tender.winnerPlayerIds } : {}),
        ...(tender.phase === 'complete' ? {
          audit: {
            anomalyConfiguration: tender.anomalyConfiguration,
            events: auditEvents!,
            privateMeasurementsByPlayer: tender.privateMeasurementsByPlayer,
            privateTelemetryByPlayer: tender.privateMeasurementsByPlayer,
            publicLaboratoryResults: tender.publicLaboratoryResults,
            publicScientificJournal: tender.publicScientificJournal,
            ratingBreakdownByPlayer: createRatingBreakdownByPlayer(tender, auditEvents!),
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
          const timedOutPlayerIds = tender.players
            .filter((player) => tender.powerAllocations[player.id] === undefined)
            .map((player) => player.id)
          if (timedOutPlayerIds.length === 0) continue
          const powerAllocations = {
            ...tender.powerAllocations,
            ...Object.fromEntries(timedOutPlayerIds.map((playerId) => [playerId, reservePowerAllocation])),
          }
          const nextTender = beginOperationalActions({ ...tender, powerAllocations })
          const completed = await commitTimeout({
            auditEvents: [{
              kind: 'power_allocation_timeout_resolved',
              payload: {
                timedOutPlayerIds,
              },
            }],
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
            : advanceAfterOperationalActions(nextTender, 'reconnaissance')
          const completed = await commitTimeout({
            auditEvents: [{
              kind: 'operational_action_timeout_resolved',
              payload: { phase: tender.phase, playerId: expectedPlayer.id },
            }],
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
          const nextTender = {
            ...tender,
            contractCompletedByPlayer: { ...tender.contractCompletedByPlayer, [expectedPlayer.id]: true },
          }
          const advancedTender = advanceAfterContracts(nextTender)
          const completed = await commitTimeout({
            auditEvents: [{ kind: 'operational_action_timeout_resolved', payload: { phase: tender.phase, playerId: expectedPlayer.id } }],
            nextTender: { ...advancedTender, dueAt: deadlineForPhase(advancedTender.phase, dueNow) },
            tender,
          })
          if (completed) advancedTenderIds.push(tenderId)
          continue
        }
        if (tender.phase === 'final-scientific-model') {
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

        const timedOutPlayers = tender.players.filter((player) => tender.requestedSlots[player.id] === undefined)
        const requestedSlots = {
          ...tender.requestedSlots,
          ...Object.fromEntries(timedOutPlayers.map((player) => [player.id, 3])),
        }
        const accessSlots = resolveAccessSlots(rotateTiePriority(tender.players, tender.round), requestedSlots)
        const timedOutPlayerIds = new Set(timedOutPlayers.map((player) => player.id))
        const budgetByPlayer = Object.fromEntries(tender.players.map((player) => [
          player.id,
          timedOutPlayerIds.has(player.id)
            ? tender.budgetByPlayer[player.id] ?? 0
            : (tender.budgetByPlayer[player.id] ?? 0) + accessSlotBudgetDelta(accessSlots[player.id] ?? 3),
        ]))
        const samplesByPlayer = { ...tender.samplesByPlayer }
        const rawTelemetrySignalsByPlayer = { ...tender.rawTelemetrySignalsByPlayer }
        const knownSignals = [...tender.knownSignals]
        const sampleCompensationByPlayer: Record<string, SignalId> = {}
        for (const player of tender.players) {
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
export { createPrismaRealtimeTicketStore } from './realtime/prisma-realtime-ticket-store'
export { createPrismaTenderStore } from './infrastructure/prisma-tender-store'
export {
  createRealtimeWebSocketHandlers,
  upgradeRealtimeWebSocket,
  type RealtimeSocketData,
} from './realtime/websocket'
import { randomUUID } from 'node:crypto'
