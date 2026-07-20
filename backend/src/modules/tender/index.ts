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
import { createAnomalyConfiguration, type SignalId } from './domain/anomaly-configuration'
import { TenderFailure } from './domain/errors'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

type CreateTenderModuleOptions = {
  seedGenerator?: () => string
  store?: TenderStore
}

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
        knownSignals: ['aster', 'boreal'],
        powerAllocations: {},
        rawTelemetrySignalsByPlayer: Object.fromEntries(parsedInput.data.players.map((player) => [player.id, ['aster']])),
        reconnaissanceCompletedByPlayer: {},
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
              payload: { accessSlots },
            }] : []),
          ],
          command,
          commandFingerprint,
          nextTender: { ...tender, accessSlots, phase, requestedSlots },
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
        nextTender: { ...nextTender, phase: isReadyForLaboratory ? 'laboratory' : tender.phase },
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
        tenderId,
        version: tender.version,
        phase: tender.phase,
        players: tender.players.map((player) => ({
          playerId: player.id,
          ...(tender.phase !== 'access-slot-selection' ? { accessSlot: tender.accessSlots[player.id] } : {}),
          ...(tender.phase !== 'access-slot-selection' && tender.powerAllocations[player.id]
            ? { powerAllocation: tender.powerAllocations[player.id] }
            : {}),
          ...(tender.phase === 'access-slot-selection' && player.id === playerId && tender.requestedSlots[player.id] !== undefined
            ? { requestedAccessSlot: tender.requestedSlots[player.id] }
            : {}),
        })),
        privateRawTelemetrySignals: tender.rawTelemetrySignalsByPlayer[player.id] ?? [],
        privateSamples: tender.samplesByPlayer[player.id] ?? [],
      }
    },

    async advanceDueTenders({ limit: _limit, now: _now }: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult> {
      return { advancedTenderIds: await store.findDue({ limit: _limit, now: _now }) }
    },
  }
}
import { randomUUID } from 'node:crypto'
