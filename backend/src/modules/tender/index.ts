import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  PowerAllocation,
  TenderCommand,
  TenderPlayer,
  TenderView,
  TenderViewQuery,
} from '@the-game/contracts'
import { createTenderSchema, tenderCommandSchema, tenderViewQuerySchema } from '@the-game/contracts'
import type { StoredTender, TenderStore } from './application/tender-store'
import { resolveAccessSlots } from './domain/access-slots'
import { createAnomalyConfiguration, resolvePublicResult, signalIds, type SignalId } from './domain/anomaly-configuration'
import { TenderFailure } from './domain/errors'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

type CreateTenderModuleOptions = {
  now?: () => Date
  seedGenerator?: () => string
  store?: TenderStore
}

const accessSlotSelectionDurationMs = 45_000
const powerAllocationDurationMs = 60_000
const operationalActionDurationMs = 20_000

const deadlineForPhase = (phase: string, at: Date) => {
  if (phase === 'access-slot-selection') return new Date(at.getTime() + accessSlotSelectionDurationMs)
  if (phase === 'power-allocation') return new Date(at.getTime() + powerAllocationDurationMs)
  if (phase === 'complete') return null
  return new Date(at.getTime() + operationalActionDurationMs)
}

const reservePowerAllocation: PowerAllocation = {
  contracts: 0,
  laboratory: 0,
  modelAnalysis: 0,
  reconnaissance: 0,
  reserve: 4,
}

const createRoundContracts = (round: number, playerCount: number) => Array.from(
  { length: playerCount + 1 },
  (_, index) => ({
    contractId: `round-${round}-contract-${index + 1}`,
    requiredPublicResult: ['reflection', 'attenuation', 'transmission_gain', 'unstable_collapse'][index % 4] as 'reflection' | 'attenuation' | 'transmission_gain' | 'unstable_collapse',
  }),
)

const accessSlotBudgetDelta = (slot: number) => {
  if (slot === 1) return -2
  if (slot === 2) return -1
  if (slot === 6) return 1
  return 0
}

const receivesAccessSlotSampleCompensation = (slot: number) => slot === 4 || slot === 6

const receivesAccessSlotAnalyticalReportCompensation = (slot: number) => slot === 5

const nextCompensationSample = (currentSamples: SignalId[]) => signalIds.find((signalId) => !currentSamples.includes(signalId))

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

  const nextPowerAllocationPlayer = (tender: StoredTender) => tender.players
    .filter((player) => tender.powerAllocations[player.id] === undefined)
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextReconnaissancePlayer = (tender: StoredTender) => tender.players
    .filter((player) => tender.powerAllocations[player.id]?.reconnaissance > 0 && !tender.reconnaissanceCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextLaboratoryPlayer = (tender: StoredTender) => tender.players
    .filter((player) => tender.powerAllocations[player.id]?.laboratory > 0 && !tender.laboratoryCompletedByPlayer[player.id])
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]
  const nextModelAnalysisPlayer = (tender: StoredTender) => tender.players.filter((player) => tender.powerAllocations[player.id]?.modelAnalysis > 0 && !tender.modelAnalysisCompletedByPlayer[player.id]).sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const effectiveContractPower = (tender: StoredTender, playerId: string) => Math.max(
    0,
    (tender.powerAllocations[playerId]?.contracts ?? 0) - (tender.contractPowerRestrictionsByPlayer[playerId] ?? 0),
  )

  const nextContractsPlayer = (tender: StoredTender) => tender.players
    .filter((player) => effectiveContractPower(tender, player.id) > 0)
    .filter((player) => !tender.contractCompletedByPlayer[player.id])
    .filter((player) => tender.publicContracts.every((contract) => contract.reservedByPlayerId !== player.id || contract.bidOutcome === undefined))
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextOperationalPhase = (tender: StoredTender, after: 'reconnaissance' | 'laboratory' | 'model-analysis') => {
    if (after === 'reconnaissance' && nextLaboratoryPlayer(tender)) return 'laboratory'
    if (after !== 'model-analysis' && nextModelAnalysisPlayer(tender)) return 'model-analysis'
    if (nextContractsPlayer(tender)) return 'contracts'
    return 'complete'
  }

  const firstOperationalPhase = (tender: StoredTender) => nextReconnaissancePlayer(tender)
    ? 'reconnaissance'
    : nextOperationalPhase(tender, 'reconnaissance')

  const advanceAfterContracts = (tender: StoredTender): StoredTender => {
    if (nextContractsPlayer(tender)) return { ...tender, phase: 'contracts' }
    if (tender.round >= 5) return { ...tender, phase: 'complete' }
    const round = tender.round + 1
    return {
      ...tender,
      accessSlots: {},
      contractCompletedByPlayer: {},
      laboratoryCompletedByPlayer: {},
      modelAnalysisCompletedByPlayer: {},
      phase: 'access-slot-selection',
      powerAllocations: {},
      publicContracts: createRoundContracts(round, tender.players.length),
      reconnaissanceCompletedByPlayer: {},
      requestedSlots: {},
      round,
    }
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
    return result.kind === 'committed'
  }

  return {
    async createTender(input: CreateTender) {
      const parsedInput = createTenderSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new TenderFailure('invalid_create_tender', 'Tender creation input is invalid')
      }
      const tender = await store.create({
        accessSlots: {},
        analyticalReportsByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 1])),
        anomalyConfiguration: createAnomalyConfiguration(seedGenerator()),
        budgetByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 2])),
        contractCompletedByPlayer: {},
        contractPowerRestrictionsByPlayer: {},
        dueAt: deadlineForPhase('access-slot-selection', now()),
        knownSignals: ['aster', 'boreal'],
        powerAllocations: {},
        publicContracts: createRoundContracts(1, parsedInput.data.players.length),
        publicLaboratoryResults: [],
        publicTheses: [],
        ratingByPlayer: {},
        round: 1,
        rawTelemetrySignalsByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, ['aster']])),
        reconnaissanceCompletedByPlayer: {},
        laboratoryCompletedByPlayer: {},
        modelAnalysisCompletedByPlayer: {},
        privateMeasurementsByPlayer: {},
        privateWorkingModelsByPlayer: {},
        players: parsedInput.data.players,
        requestedSlots: {},
        samplesByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, ['aster']])),
        processedCommands: {},
        phase: 'access-slot-selection',
        version: 0,
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
        const analyticalReportsByPlayer = isReadyToResolve
          ? Object.fromEntries(tender.players.map((player) => [
            player.id,
            (tender.analyticalReportsByPlayer[player.id] ?? 0) + (receivesAccessSlotAnalyticalReportCompensation(accessSlots[player.id] ?? 3) ? 1 : 0),
          ]))
          : tender.analyticalReportsByPlayer
        const sampleCompensationByPlayer: Record<string, SignalId> = {}
        const samplesByPlayer = isReadyToResolve ? { ...tender.samplesByPlayer } : tender.samplesByPlayer
        const rawTelemetrySignalsByPlayer = isReadyToResolve ? { ...tender.rawTelemetrySignalsByPlayer } : tender.rawTelemetrySignalsByPlayer
        if (isReadyToResolve) {
          for (const player of tender.players) {
            if (!receivesAccessSlotSampleCompensation(accessSlots[player.id] ?? 3)) continue
            const nextSample = nextCompensationSample(samplesByPlayer[player.id] ?? [])
            if (!nextSample) continue
            sampleCompensationByPlayer[player.id] = nextSample
            samplesByPlayer[player.id] = [...(samplesByPlayer[player.id] ?? []), nextSample]
            rawTelemetrySignalsByPlayer[player.id] = [...(rawTelemetrySignalsByPlayer[player.id] ?? []), nextSample]
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
              payload: { accessSlots, analyticalReportsByPlayer, budgetByPlayer, sampleCompensationByPlayer },
            }] : []),
          ],
          command,
          commandFingerprint,
          nextTender: {
            ...tender,
            accessSlots,
            analyticalReportsByPlayer,
            budgetByPlayer,
            dueAt: isReadyToResolve ? deadlineForPhase('power-allocation', now()) : tender.dueAt,
            phase,
            rawTelemetrySignalsByPlayer,
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
        const expectedPlayer = nextPowerAllocationPlayer(tender)
        if (expectedPlayer?.id !== player.id) {
          throw new TenderFailure('invalid_tender_state', 'It is not this Player\'s Power allocation turn')
        }
        const powerAllocations: Record<string, PowerAllocation> = { ...tender.powerAllocations, [player.id]: command.allocation }
        const isReadyToStartReconnaissance = Object.keys(powerAllocations).length === tender.players.length
        const phase = isReadyToStartReconnaissance ? firstOperationalPhase({ ...tender, powerAllocations }) : tender.phase
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
            ...tender,
            dueAt: isReadyToStartReconnaissance
              ? deadlineForPhase(phase, now())
              : tender.dueAt,
            powerAllocations,
            phase,
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
        const laboratoryCompletedByPlayer = { ...tender.laboratoryCompletedByPlayer, [player.id]: true }
        const contractPowerRestrictionsByPlayer = {
          ...tender.contractPowerRestrictionsByPlayer,
          [player.id]: 0,
        }
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
          contractPowerRestrictionsByPlayer,
          laboratoryCompletedByPlayer,
          privateMeasurementsByPlayer,
          publicLaboratoryResults,
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
            const phase = nextLaboratoryPlayer(nextTender) ? 'laboratory' : nextOperationalPhase(nextTender, 'laboratory')
            return { ...nextTender, dueAt: deadlineForPhase(phase, now()), phase }
          })(),
          tender,
        })
      }

      if (command.type === 'submit-thesis') {
        if (tender.phase !== 'model-analysis' || nextModelAnalysisPlayer(tender)?.id !== player.id) throw new TenderFailure('invalid_tender_state', 'Model analysis is not available to this Player')
        const actual = tender.anomalyConfiguration.signals[command.signalId]
        const correct = actual.fieldType === command.fieldType && actual.polarity === command.polarity
        const modelAnalysisCompletedByPlayer = { ...tender.modelAnalysisCompletedByPlayer, [player.id]: true }
        const ratingByPlayer = correct
          ? { ...tender.ratingByPlayer, [player.id]: (tender.ratingByPlayer[player.id] ?? 0) + 1 }
          : tender.ratingByPlayer
        const contractPowerRestrictionsByPlayer = correct
          ? tender.contractPowerRestrictionsByPlayer
          : { ...tender.contractPowerRestrictionsByPlayer, [player.id]: 1 }
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
          contractPowerRestrictionsByPlayer,
          modelAnalysisCompletedByPlayer,
          publicTheses,
          ratingByPlayer,
        }
        return commitCommand({ auditEvents: [{ actorId: command.actorId, commandId: command.commandId, kind: 'thesis_checked', payload: { correct, playerId: player.id, signalId: command.signalId } }], command, commandFingerprint, nextTender: (() => {
          const phase = nextModelAnalysisPlayer(nextTender) ? 'model-analysis' : nextOperationalPhase(nextTender, 'model-analysis')
          return { ...nextTender, dueAt: deadlineForPhase(phase, now()), phase }
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

      if (command.type === 'reserve-contract') {
        if (tender.phase !== 'contracts') {
          throw new TenderFailure('invalid_tender_state', 'Contracts are closed')
        }
        const expectedPlayer = nextContractsPlayer(tender)
        const contract = tender.publicContracts.find((candidate) => candidate.contractId === command.contractId)
        const alreadyReservedContract = tender.publicContracts.some((candidate) => candidate.reservedByPlayerId === player.id)
        if (!contract || contract.reservedByPlayerId || alreadyReservedContract || expectedPlayer?.id !== player.id) {
          throw new TenderFailure('invalid_tender_state', 'Contract reservation is not available to this Player')
        }
        const publicContracts = tender.publicContracts.map((candidate) => candidate.contractId === command.contractId
          ? { ...candidate, reservedByPlayerId: player.id }
          : candidate)
        const nextTender = { ...tender, publicContracts }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'contract_reserved',
            payload: { contractId: command.contractId, playerId: player.id },
          }],
          command,
          commandFingerprint,
          nextTender: { ...nextTender, dueAt: deadlineForPhase('contracts', now()), phase: 'contracts' },
          tender,
        })
      }

      if (command.type === 'submit-contract-bid') {
        if (tender.phase !== 'contracts') {
          throw new TenderFailure('invalid_tender_state', 'Contracts are closed')
        }
        const expectedPlayer = nextContractsPlayer(tender)
        const contract = tender.publicContracts.find((candidate) => candidate.contractId === command.contractId)
        if (!contract || contract.bidOutcome !== undefined || contract.reservedByPlayerId !== player.id || expectedPlayer?.id !== player.id) {
          throw new TenderFailure('invalid_tender_state', 'Contract Bid is not available to this Player')
        }
        const hasMatchingEvidence = tender.publicLaboratoryResults.some((result) => result.playerId === player.id && result.publicResult === command.claimedPublicResult)
        const isAwarded = command.claimedPublicResult === contract.requiredPublicResult && hasMatchingEvidence
        const publicContracts = tender.publicContracts.map((candidate) => candidate.contractId === command.contractId
          ? {
            ...candidate,
            ...(isAwarded ? { awardedToPlayerId: player.id } : {}),
            bidOutcome: isAwarded ? 'awarded' as const : 'failed' as const,
          }
          : candidate)
        const budgetByPlayer = isAwarded
          ? { ...tender.budgetByPlayer, [player.id]: (tender.budgetByPlayer[player.id] ?? 0) + command.requestedFunding }
          : tender.budgetByPlayer
        const nextTender = { ...tender, budgetByPlayer, contractCompletedByPlayer: { ...tender.contractCompletedByPlayer, [player.id]: true }, publicContracts }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'contract_bid_assessed',
            payload: {
              awarded: isAwarded,
              awardedToPlayerId: isAwarded ? player.id : undefined,
              budgetByPlayer,
              contractId: command.contractId,
              playerId: player.id,
              requestedFunding: command.requestedFunding,
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
      if (expectedPlayer?.id !== player.id || command.signals.length !== tender.powerAllocations[player.id]?.reconnaissance) {
        throw new TenderFailure('invalid_tender_state', 'Reconnaissance command is not available to this Player')
      }
      const currentSamples = tender.samplesByPlayer[player.id] ?? []
      if (command.signals.some((signal) => currentSamples.includes(signal))) {
        throw new TenderFailure('invalid_tender_state', 'A Player cannot acquire a Sample it already holds')
      }
      const samplesByPlayer = { ...tender.samplesByPlayer, [player.id]: [...currentSamples, ...command.signals] as SignalId[] }
      const rawTelemetrySignalsByPlayer = {
        ...tender.rawTelemetrySignalsByPlayer,
        [player.id]: [...(tender.rawTelemetrySignalsByPlayer[player.id] ?? []), ...command.signals] as SignalId[],
      }
      const reconnaissanceCompletedByPlayer = { ...tender.reconnaissanceCompletedByPlayer, [player.id]: true }
      const knownSignals = [...tender.knownSignals]
      for (const signal of command.signals) {
        if (!knownSignals.includes(signal)) knownSignals.push(signal)
      }
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
          payload: { signals: command.signals, playerId: player.id },
        }],
        command,
        commandFingerprint,
        nextTender: (() => {
          const phase = isReadyForLaboratory ? nextOperationalPhase(nextTender, 'reconnaissance') : tender.phase
          return { ...nextTender, dueAt: deadlineForPhase(phase, now()), phase }
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
      return {
        knownSignals: tender.knownSignals,
        publicContracts: tender.publicContracts,
        publicLaboratoryResults: tender.publicLaboratoryResults,
        round: tender.round,
        tenderId,
        version: tender.version,
        phase: tender.phase,
        players: tender.players.map((player) => ({
          playerId: player.id,
          ...(tender.phase !== 'access-slot-selection' ? { accessSlot: tender.accessSlots[player.id] } : {}),
          budget: tender.budgetByPlayer[player.id] ?? 0,
          contractPowerRestriction: tender.contractPowerRestrictionsByPlayer[player.id] ?? 0,
          ...(tender.phase !== 'access-slot-selection' && tender.powerAllocations[player.id]
            ? { powerAllocation: tender.powerAllocations[player.id] }
            : {}),
          rating: tender.ratingByPlayer[player.id] ?? 0,
          ...(tender.phase === 'access-slot-selection' && player.id === playerId && tender.requestedSlots[player.id] !== undefined
            ? { requestedAccessSlot: tender.requestedSlots[player.id] }
            : {}),
        })),
        privateRawTelemetrySignals: tender.rawTelemetrySignalsByPlayer[player.id] ?? [],
        privateAnalyticalReports: tender.analyticalReportsByPlayer[player.id] ?? 0,
        privateSamples: tender.samplesByPlayer[player.id] ?? [],
        privateMeasurements: tender.privateMeasurementsByPlayer[player.id] ?? [],
        privateWorkingModel: tender.privateWorkingModelsByPlayer[player.id] ?? { signals: {} },
        publicTheses: tender.publicTheses,
        ...(tender.phase === 'complete' ? {
          audit: {
            anomalyConfiguration: tender.anomalyConfiguration,
            events: await store.readAuditEvents(tenderId),
            privateMeasurementsByPlayer: tender.privateMeasurementsByPlayer,
          },
        } : {}),
      }
    },

    async advanceDueTenders({ limit, now: dueNow }: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult> {
      const advancedTenderIds: string[] = []
      for (const tenderId of await store.findDue({ limit, now: dueNow })) {
        const tender = await store.read(tenderId)
        if (!tender || tender.dueAt === null || tender.dueAt > dueNow) continue

        if (tender.phase === 'power-allocation') {
          const powerAllocations = { ...tender.powerAllocations }
          for (const player of tender.players) {
            if (powerAllocations[player.id] === undefined) powerAllocations[player.id] = reservePowerAllocation
          }
          const phase = firstOperationalPhase({ ...tender, powerAllocations })
          const completed = await commitTimeout({
            auditEvents: [{
              kind: 'power_allocation_timeout_resolved',
              payload: {
                timedOutPlayerIds: tender.players
                  .filter((player) => tender.powerAllocations[player.id] === undefined)
                  .map((player) => player.id),
              },
            }],
            nextTender: {
              ...tender,
              dueAt: deadlineForPhase(phase, dueNow),
              phase,
              powerAllocations,
            },
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
          const phase = nextReconnaissancePlayer(nextTender)
            ? 'reconnaissance'
            : nextOperationalPhase(nextTender, 'reconnaissance')
          const completed = await commitTimeout({
            auditEvents: [{
              kind: 'operational_action_timeout_resolved',
              payload: { phase: tender.phase, playerId: expectedPlayer.id },
            }],
            nextTender: {
              ...nextTender,
              dueAt: deadlineForPhase(phase, dueNow),
              phase,
            },
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
          const phase = nextLaboratoryPlayer(nextTender)
            ? 'laboratory'
            : nextOperationalPhase(nextTender, 'laboratory')
          const completed = await commitTimeout({
            auditEvents: [{ kind: 'operational_action_timeout_resolved', payload: { phase: tender.phase, playerId: expectedPlayer.id } }],
            nextTender: { ...nextTender, dueAt: deadlineForPhase(phase, dueNow), phase },
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
          const phase = nextModelAnalysisPlayer(nextTender)
            ? 'model-analysis'
            : nextOperationalPhase(nextTender, 'model-analysis')
          const completed = await commitTimeout({
            auditEvents: [{ kind: 'operational_action_timeout_resolved', payload: { phase: tender.phase, playerId: expectedPlayer.id } }],
            nextTender: { ...nextTender, dueAt: deadlineForPhase(phase, dueNow), phase },
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
        const analyticalReportsByPlayer = Object.fromEntries(tender.players.map((player) => [
          player.id,
          (tender.analyticalReportsByPlayer[player.id] ?? 0)
            + (!timedOutPlayerIds.has(player.id) && receivesAccessSlotAnalyticalReportCompensation(accessSlots[player.id] ?? 3) ? 1 : 0),
        ]))
        const samplesByPlayer = { ...tender.samplesByPlayer }
        const rawTelemetrySignalsByPlayer = { ...tender.rawTelemetrySignalsByPlayer }
        const sampleCompensationByPlayer: Record<string, SignalId> = {}
        for (const player of tender.players) {
          if (timedOutPlayerIds.has(player.id) || !receivesAccessSlotSampleCompensation(accessSlots[player.id] ?? 3)) continue
          const nextSample = nextCompensationSample(samplesByPlayer[player.id] ?? [])
          if (!nextSample) continue
          sampleCompensationByPlayer[player.id] = nextSample
          samplesByPlayer[player.id] = [...(samplesByPlayer[player.id] ?? []), nextSample]
          rawTelemetrySignalsByPlayer[player.id] = [...(rawTelemetrySignalsByPlayer[player.id] ?? []), nextSample]
        }
        const completed = await commitTimeout({
          auditEvents: [{
            kind: 'access_slot_timeout_resolved',
            payload: { accessSlots, analyticalReportsByPlayer, budgetByPlayer, sampleCompensationByPlayer, timedOutPlayerIds: [...timedOutPlayerIds] },
          }],
          nextTender: {
            ...tender,
            accessSlots,
            analyticalReportsByPlayer,
            budgetByPlayer,
            dueAt: deadlineForPhase('power-allocation', dueNow),
            phase: 'power-allocation',
            rawTelemetrySignalsByPlayer,
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
import { randomUUID } from 'node:crypto'
