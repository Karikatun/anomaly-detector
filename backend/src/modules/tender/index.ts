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
  seedGenerator?: () => string
  store?: TenderStore
}

const createRoundContracts = (playerCount: number) => Array.from(
  { length: playerCount + 1 },
  (_, index) => ({
    contractId: `round-1-contract-${index + 1}`,
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

const nextCompensationSample = (currentSamples: SignalId[]) => signalIds.find((signalId) => !currentSamples.includes(signalId))

export function createTenderModule({
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
    .filter((player) => tender.publicContracts.every((contract) => contract.reservedByPlayerId !== player.id || contract.bidOutcome === undefined))
    .sort((left, right) => tender.accessSlots[left.id] - tender.accessSlots[right.id])[0]

  const nextOperationalPhase = (tender: StoredTender, after: 'reconnaissance' | 'laboratory' | 'model-analysis') => {
    if (after === 'reconnaissance' && nextLaboratoryPlayer(tender)) return 'laboratory'
    if (after !== 'model-analysis' && nextModelAnalysisPlayer(tender)) return 'model-analysis'
    if (nextContractsPlayer(tender)) return 'contracts'
    return 'complete'
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

  return {
    async createTender(input: CreateTender) {
      const parsedInput = createTenderSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new TenderFailure('invalid_create_tender', 'Tender creation input is invalid')
      }
      const tender = await store.create({
        accessSlots: {},
        anomalyConfiguration: createAnomalyConfiguration(seedGenerator()),
        budgetByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, 2])),
        contractPowerRestrictionsByPlayer: {},
        knownSignals: ['aster', 'boreal'],
        powerAllocations: {},
        publicContracts: createRoundContracts(parsedInput.data.players.length),
        publicLaboratoryResults: [],
        publicTheses: [],
        ratingByPlayer: {},
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
        const accessSlots = isReadyToResolve ? resolveAccessSlots(tender.players, requestedSlots) : tender.accessSlots
        const budgetByPlayer = isReadyToResolve
          ? Object.fromEntries(tender.players.map((player) => [
            player.id,
            (tender.budgetByPlayer[player.id] ?? 0) + accessSlotBudgetDelta(accessSlots[player.id] ?? 3),
          ]))
          : tender.budgetByPlayer
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
              payload: { accessSlots, budgetByPlayer, sampleCompensationByPlayer },
            }] : []),
          ],
          command,
          commandFingerprint,
          nextTender: {
            ...tender,
            accessSlots,
            budgetByPlayer,
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
            phase: isReadyToStartReconnaissance ? 'reconnaissance' : tender.phase,
            powerAllocations,
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
          nextTender: { ...nextTender, phase: nextLaboratoryPlayer(nextTender) ? 'laboratory' : nextOperationalPhase(nextTender, 'laboratory') },
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
          },
        ]
        const nextTender = {
          ...tender,
          contractPowerRestrictionsByPlayer,
          modelAnalysisCompletedByPlayer,
          publicTheses,
          ratingByPlayer,
        }
        return commitCommand({ auditEvents: [{ actorId: command.actorId, commandId: command.commandId, kind: 'thesis_checked', payload: { correct, playerId: player.id, signalId: command.signalId } }], command, commandFingerprint, nextTender: { ...nextTender, phase: nextModelAnalysisPlayer(nextTender) ? 'model-analysis' : nextOperationalPhase(nextTender, 'model-analysis') }, tender })
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
          nextTender: { ...nextTender, phase: 'contracts' },
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
        const nextTender = { ...tender, publicContracts }
        return commitCommand({
          auditEvents: [{
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'contract_bid_assessed',
            payload: {
              awarded: isAwarded,
              awardedToPlayerId: isAwarded ? player.id : undefined,
              contractId: command.contractId,
              playerId: player.id,
              requestedFunding: command.requestedFunding,
            },
          }],
          command,
          commandFingerprint,
          nextTender: { ...nextTender, phase: nextContractsPlayer(nextTender) ? 'contracts' : 'complete' },
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
        nextTender: { ...nextTender, phase: isReadyForLaboratory ? nextOperationalPhase(nextTender, 'reconnaissance') : tender.phase },
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
        privateSamples: tender.samplesByPlayer[player.id] ?? [],
        privateMeasurements: tender.privateMeasurementsByPlayer[player.id] ?? [],
        privateWorkingModel: tender.privateWorkingModelsByPlayer[player.id] ?? { signals: {} },
        publicTheses: tender.publicTheses,
      }
    },

    async advanceDueTenders({ limit: _limit, now: _now }: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult> {
      return { advancedTenderIds: await store.findDue({ limit: _limit, now: _now }) }
    },
  }
}
import { randomUUID } from 'node:crypto'
