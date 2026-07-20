import type { TenderTeam } from '@the-game/contracts'

const accessSlotCount = 6

export function resolveAccessSlots(
  teams: TenderTeam[],
  requestedSlots: Record<string, number>,
): Record<string, number> {
  const occupied = new Set<number>()
  const assignedSlots: Record<string, number> = {}
  const displaced: TenderTeam[] = []
  const orderedTeams = [...teams].sort((left, right) => {
    const requestedOrder = requestedSlots[left.id] - requestedSlots[right.id]
    return requestedOrder || left.tiePriority - right.tiePriority
  })

  for (const team of orderedTeams) {
    const requestedSlot = requestedSlots[team.id]
    if (occupied.has(requestedSlot)) {
      displaced.push(team)
      continue
    }
    assignedSlots[team.id] = requestedSlot
    occupied.add(requestedSlot)
  }

  for (const team of displaced) {
    let assignedSlot = requestedSlots[team.id] + 1
    while (occupied.has(assignedSlot)) assignedSlot += 1
    if (assignedSlot > accessSlotCount) throw new Error('No later Access Slot is available')
    assignedSlots[team.id] = assignedSlot
    occupied.add(assignedSlot)
  }

  return assignedSlots
}
