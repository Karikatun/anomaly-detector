import type { TenderPlayer } from '@the-game/contracts'

const accessSlotCount = 6

export function resolveAccessSlots(
  players: TenderPlayer[],
  requestedSlots: Record<string, number>,
): Record<string, number> {
  const occupied = new Set<number>()
  const assignedSlots: Record<string, number> = {}
  const displaced: TenderPlayer[] = []
  const orderedPlayers = [...players].sort((left, right) => {
    const requestedOrder = requestedSlots[left.id] - requestedSlots[right.id]
    return requestedOrder || left.tiePriority - right.tiePriority
  })

  for (const player of orderedPlayers) {
    const requestedSlot = requestedSlots[player.id]
    if (occupied.has(requestedSlot)) {
      displaced.push(player)
      continue
    }
    assignedSlots[player.id] = requestedSlot
    occupied.add(requestedSlot)
  }

  for (const player of displaced) {
    const requestedSlot = requestedSlots[player.id]
    const assignedSlot = Array.from({ length: accessSlotCount }, (_, index) => index + 1)
      .filter((slot) => !occupied.has(slot))
      .sort((left, right) => {
        const distanceOrder = Math.abs(left - requestedSlot) - Math.abs(right - requestedSlot)
        return distanceOrder || right - left
      })[0]

    if (assignedSlot === undefined) throw new Error('No Access Slot is available')
    assignedSlots[player.id] = assignedSlot
    occupied.add(assignedSlot)
  }

  return assignedSlots
}
