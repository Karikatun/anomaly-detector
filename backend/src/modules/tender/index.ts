type TeamId = string

type Team = {
  id: TeamId
  tiePriority: number
}

type Tender = {
  teams: Team[]
  accessSlots: Map<TeamId, number>
  requestedSlots: Map<TeamId, number>
}

type CreateTenderInput = {
  teams: Team[]
}

type TenderCommand =
  | { tenderId: string; type: 'request-access-slot'; teamId: TeamId; slot: number }
  | { tenderId: string; type: 'resolve-access-slots' }

const accessSlotCount = 6

export function createTenderModule() {
  const tenders = new Map<string, Tender>()
  let nextTenderId = 1

  const readTender = (tenderId: string) => {
    const tender = tenders.get(tenderId)
    if (!tender) throw new Error(`Unknown Tender ${tenderId}`)
    return tender
  }

  return {
    createTender(input: CreateTenderInput) {
      const tenderId = `tender-${nextTenderId++}`
      tenders.set(tenderId, {
        teams: input.teams,
        accessSlots: new Map(),
        requestedSlots: new Map(),
      })
      return { tenderId }
    },

    execute(command: TenderCommand) {
      const tender = readTender(command.tenderId)

      if (command.type === 'request-access-slot') {
        tender.requestedSlots.set(command.teamId, command.slot)
        return
      }

      const occupied = new Set<number>()
      const displaced: Team[] = []
      const teamsByRequest = [...tender.teams].sort((left, right) => {
        const slotOrder = tender.requestedSlots.get(left.id)! - tender.requestedSlots.get(right.id)!
        return slotOrder || left.tiePriority - right.tiePriority
      })

      for (const team of teamsByRequest) {
        const requestedSlot = tender.requestedSlots.get(team.id)!
        if (occupied.has(requestedSlot)) {
          displaced.push(team)
          continue
        }
        tender.accessSlots.set(team.id, requestedSlot)
        occupied.add(requestedSlot)
      }

      for (const team of displaced) {
        let slot = tender.requestedSlots.get(team.id)! + 1
        while (occupied.has(slot)) slot += 1
        if (slot > accessSlotCount) throw new Error('No later Access Slot is available.')
        tender.accessSlots.set(team.id, slot)
        occupied.add(slot)
      }
    },

    readTenderView({ tenderId }: { tenderId: string; teamId: TeamId }) {
      const tender = readTender(tenderId)
      return {
        accessSlots: tender.teams.map((team) => ({
          teamId: team.id,
          slot: tender.accessSlots.get(team.id),
        })),
      }
    },
  }
}
