import type {
  TenderCommit,
  TenderCommitResult,
  TenderStore,
  StoredTender,
  StoredTenderAuditEvent,
} from '../application/tender-store'

const cloneTender = (tender: StoredTender) => structuredClone(tender)

export function createInMemoryTenderStore(): TenderStore {
  const tenders = new Map<string, StoredTender>()
  const auditEvents = new Map<string, StoredTenderAuditEvent[]>()
  let nextTenderId = 1

  const readCurrentTender = (tenderId: string) => {
    const tender = tenders.get(tenderId)
    if (!tender) throw new Error(`Unknown Tender ${tenderId}`)
    return tender
  }

  return {
    async anonymizeParticipant(playerId) {
      const changedTenderIds: string[] = []
      for (const [tenderId, tender] of tenders) {
        if (!tender.players.some((player) => player.id === playerId && player.displayName !== 'Deleted participant')) continue
        tenders.set(tenderId, {
          ...tender,
          players: tender.players.map((player) => player.id === playerId
            ? { ...player, displayName: 'Deleted participant' }
            : player),
          version: tender.version + 1,
        })
        changedTenderIds.push(tenderId)
      }
      return changedTenderIds
    },

    async create(tender) {
      const createdTender = { ...tender, id: `tender-${nextTenderId++}` }
      tenders.set(createdTender.id, cloneTender(createdTender))
      auditEvents.set(createdTender.id, [])
      return cloneTender(createdTender)
    },

    async read(tenderId) {
      const tender = tenders.get(tenderId)
      return tender ? cloneTender(tender) : null
    },

    async commit(change: TenderCommit): Promise<TenderCommitResult> {
      const current = readCurrentTender(change.tenderId)
      const previousCommand = change.commandId ? current.processedCommands[change.commandId] : undefined
      if (previousCommand) return { kind: 'command_exists', command: structuredClone(previousCommand) }
      if (current.version !== change.expectedVersion) return { kind: 'version_conflict' }

      const nextTender = cloneTender(change.nextTender)
      if (change.commandId && change.command) {
        nextTender.processedCommands[change.commandId] = structuredClone(change.command)
      }
      tenders.set(change.tenderId, nextTender)
      const currentEvents = auditEvents.get(change.tenderId) ?? []
      auditEvents.set(change.tenderId, [
        ...currentEvents,
        ...change.auditEvents.map((event, index) => ({
          ...event,
          sequence: currentEvents.length + index + 1,
        })),
      ])
      return { kind: 'committed' }
    },

    async findDue({ limit, now }) {
      return [...tenders.values()]
        .filter((tender) => tender.dueAt !== null && tender.dueAt <= now)
        .sort((left, right) => left.dueAt!.getTime() - right.dueAt!.getTime())
        .slice(0, limit)
        .map((tender) => tender.id)
    },

    async readAuditEvents(tenderId) {
      return structuredClone(auditEvents.get(tenderId) ?? [])
    },
  }
}
