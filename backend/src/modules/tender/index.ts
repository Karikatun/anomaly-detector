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
import { TenderFailure } from './domain/errors'
import { createInMemoryTenderStore } from './infrastructure/in-memory-tender-store'

type CreateTenderModuleOptions = {
  store?: TenderStore
}

export function createTenderModule({ store = createInMemoryTenderStore() }: CreateTenderModuleOptions = {}) {
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

      const team = readParticipantTeam(tender, command.actorId)

      const receipt = { tenderId: command.tenderId, version: tender.version + 1 }
      const result = await store.commit({
        tenderId: command.tenderId,
        expectedVersion: tender.version,
        nextTender: {
          ...tender,
          requestedSlots: { ...tender.requestedSlots, [team.id]: command.slot },
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
        phase: 'access-slot-selection' as const,
        teams: tender.teams.map((team) => ({
          teamId: team.id,
          ...(team.participantId === participantId && tender.requestedSlots[team.id] !== undefined
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
