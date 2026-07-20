import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  TenderCommand,
  TenderTeam,
  TenderView,
} from '@the-game/contracts'
import { createTenderSchema, tenderCommandSchema } from '@the-game/contracts'
import { TenderFailure } from './domain/errors'

type Tender = {
  teams: TenderTeam[]
  requestedSlots: Map<string, number>
  processedCommands: Map<string, { command: TenderCommand; receipt: CommandReceipt }>
  version: number
}

export function createTenderModule() {
  const tenders = new Map<string, Tender>()
  let nextTenderId = 1

  const readTender = (tenderId: string) => {
    const tender = tenders.get(tenderId)
    if (!tender) throw new TenderFailure('tender_not_found', `Unknown Tender ${tenderId}`)
    return tender
  }

  const readParticipantTeam = (tender: Tender, participantId: string) => {
    const team = tender.teams.find((candidate) => candidate.participantId === participantId)
    if (!team) throw new TenderFailure('participant_not_in_tender', `Participant ${participantId} is not in this Tender`)
    return team
  }

  const isSameCommand = (left: TenderCommand, right: TenderCommand) =>
    left.commandId === right.commandId
    && left.tenderId === right.tenderId
    && left.actorId === right.actorId
    && left.type === right.type
    && left.slot === right.slot

  return {
    async createTender(input: CreateTender) {
      const parsedInput = createTenderSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new TenderFailure('invalid_create_tender', 'Tender creation input is invalid')
      }
      const tenderId = `tender-${nextTenderId++}`
      tenders.set(tenderId, {
        teams: parsedInput.data.teams,
        requestedSlots: new Map(),
        processedCommands: new Map(),
        version: 0,
      })
      return { tenderId }
    },

    async execute(commandInput: TenderCommand): Promise<CommandReceipt> {
      const parsedCommand = tenderCommandSchema.safeParse(commandInput)
      if (!parsedCommand.success) {
        throw new TenderFailure('invalid_tender_command', 'Tender command is invalid')
      }
      const command = parsedCommand.data
      const tender = readTender(command.tenderId)
      const previousCommand = tender.processedCommands.get(command.commandId)
      if (previousCommand) {
        if (!isSameCommand(previousCommand.command, command)) {
          throw new TenderFailure('duplicate_command_conflict', `Command ${command.commandId} conflicts with its first use`)
        }
        return previousCommand.receipt
      }

      const team = readParticipantTeam(tender, command.actorId)

      tender.requestedSlots.set(team.id, command.slot)
      tender.version += 1
      const receipt = { tenderId: command.tenderId, version: tender.version }
      tender.processedCommands.set(command.commandId, { command, receipt })
      return receipt
    },

    async readTenderView({ tenderId, participantId }: { tenderId: string; participantId: string }): Promise<TenderView> {
      const tender = readTender(tenderId)
      readParticipantTeam(tender, participantId)
      return {
        tenderId,
        version: tender.version,
        phase: 'access-slot-selection' as const,
        teams: tender.teams.map((team) => ({
          teamId: team.id,
          ...(team.participantId === participantId && tender.requestedSlots.has(team.id)
            ? { requestedAccessSlot: tender.requestedSlots.get(team.id) }
            : {}),
        })),
      }
    },

    async advanceDueTenders({ limit: _limit, now: _now }: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult> {
      return { advancedTenderIds: [] }
    },
  }
}
