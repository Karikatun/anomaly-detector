import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  TenderCommand,
  TenderTeam,
  TenderView,
  TenderViewQuery,
} from '@the-game/contracts'
import { createTenderSchema, tenderCommandSchema, tenderViewQuerySchema } from '@the-game/contracts'
import type { StoredTender, TenderStore } from './application/tender-store'
import { resolveAccessSlots } from './domain/access-slots'
import { createAnomalyConfiguration } from './domain/anomaly-configuration'
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

  const readParticipantTeam = (tender: StoredTender, participantId: string) => {
    const team = tender.teams.find((candidate) => candidate.participantId === participantId)
    if (!team) throw new TenderFailure('participant_not_in_tender', `Participant ${participantId} is not in this Tender`)
    return team
  }

  const fingerprint = (command: TenderCommand) => JSON.stringify(command)

  return {
    async createTender(input: CreateTender) {
      const parsedInput = createTenderSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new TenderFailure('invalid_create_tender', 'Tender creation input is invalid')
      }
      const tender = await store.create({
        accessSlots: {},
        anomalyConfiguration: createAnomalyConfiguration(seedGenerator()),
        teams: parsedInput.data.teams,
        requestedSlots: {},
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
      if (tender.phase !== 'access-slot-selection') {
        throw new TenderFailure('invalid_tender_state', 'Access Slot selection is closed')
      }

      const team = readParticipantTeam(tender, command.actorId)

      const receipt = { tenderId: command.tenderId, version: tender.version + 1 }
      const requestedSlots = { ...tender.requestedSlots, [team.id]: command.slot }
      const isReadyToResolve = Object.keys(requestedSlots).length === tender.teams.length
      const accessSlots = isReadyToResolve ? resolveAccessSlots(tender.teams, requestedSlots) : tender.accessSlots
      const phase = isReadyToResolve ? 'power-allocation' : tender.phase
      const result = await store.commit({
        auditEvents: [
          {
            actorId: command.actorId,
            commandId: command.commandId,
            kind: 'access_slot_requested',
            payload: { slot: command.slot, teamId: team.id },
          },
          ...(isReadyToResolve ? [{
            kind: 'access_slots_resolved',
            payload: { accessSlots },
          }] : []),
        ],
        tenderId: command.tenderId,
        expectedVersion: tender.version,
        nextTender: {
          ...tender,
          accessSlots,
          phase,
          requestedSlots,
          version: receipt.version,
        },
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
    },

    async readTenderView(query: TenderViewQuery): Promise<TenderView> {
      const parsedQuery = tenderViewQuerySchema.safeParse(query)
      if (!parsedQuery.success) {
        throw new TenderFailure('invalid_tender_view_query', 'Tender view query is invalid')
      }
      const { tenderId, participantId } = parsedQuery.data
      const tender = await readTender(tenderId)
      readParticipantTeam(tender, participantId)
      return {
        tenderId,
        version: tender.version,
        phase: tender.phase,
        teams: tender.teams.map((team) => ({
          teamId: team.id,
          ...(tender.phase === 'power-allocation' ? { accessSlot: tender.accessSlots[team.id] } : {}),
          ...(tender.phase === 'access-slot-selection' && team.participantId === participantId && tender.requestedSlots[team.id] !== undefined
            ? { requestedAccessSlot: tender.requestedSlots[team.id] }
            : {}),
        })),
      }
    },

    async advanceDueTenders({ limit: _limit, now: _now }: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult> {
      return { advancedTenderIds: await store.findDue({ limit: _limit, now: _now }) }
    },
  }
}
import { randomUUID } from 'node:crypto'
