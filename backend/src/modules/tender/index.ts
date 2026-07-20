import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  TenderCommand,
  TenderTeam,
  TenderView,
} from '@the-game/contracts'

type Tender = {
  teams: TenderTeam[]
  requestedSlots: Map<string, number>
  processedCommands: Map<string, CommandReceipt>
  version: number
}

export function createTenderModule() {
  const tenders = new Map<string, Tender>()
  let nextTenderId = 1

  const readTender = (tenderId: string) => {
    const tender = tenders.get(tenderId)
    if (!tender) throw new Error(`Unknown Tender ${tenderId}`)
    return tender
  }

  return {
    async createTender(input: CreateTender) {
      const tenderId = `tender-${nextTenderId++}`
      tenders.set(tenderId, {
        teams: input.teams,
        requestedSlots: new Map(),
        processedCommands: new Map(),
        version: 0,
      })
      return { tenderId }
    },

    async execute(command: TenderCommand): Promise<CommandReceipt> {
      const tender = readTender(command.tenderId)
      const previousReceipt = tender.processedCommands.get(command.commandId)
      if (previousReceipt) return previousReceipt

      const team = tender.teams.find((candidate) => candidate.participantId === command.actorId)
      if (!team) throw new Error(`Participant ${command.actorId} is not in this Tender`)

      tender.requestedSlots.set(team.id, command.slot)
      tender.version += 1
      const receipt = { tenderId: command.tenderId, version: tender.version }
      tender.processedCommands.set(command.commandId, receipt)
      return receipt
    },

    async readTenderView({ tenderId, participantId }: { tenderId: string; participantId: string }): Promise<TenderView> {
      const tender = readTender(tenderId)
      if (!tender.teams.some((team) => team.participantId === participantId)) {
        throw new Error(`Participant ${participantId} is not in this Tender`)
      }
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
