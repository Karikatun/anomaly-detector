import type {
  TenderCommit,
  TenderCommitResult,
  TenderStore,
  StoredTender,
} from '../application/tender-store'

const cloneTender = (tender: StoredTender) => structuredClone(tender)

export function createInMemoryTenderStore(): TenderStore {
  const tenders = new Map<string, StoredTender>()
  let nextTenderId = 1

  const readCurrentTender = (tenderId: string) => {
    const tender = tenders.get(tenderId)
    if (!tender) throw new Error(`Unknown Tender ${tenderId}`)
    return tender
  }

  return {
    async create(tender) {
      const createdTender = { ...tender, id: `tender-${nextTenderId++}` }
      tenders.set(createdTender.id, cloneTender(createdTender))
      return cloneTender(createdTender)
    },

    async read(tenderId) {
      const tender = tenders.get(tenderId)
      return tender ? cloneTender(tender) : null
    },

    async commit(change: TenderCommit): Promise<TenderCommitResult> {
      const current = readCurrentTender(change.tenderId)
      const previousCommand = current.processedCommands[change.commandId]
      if (previousCommand) return { kind: 'command_exists', command: structuredClone(previousCommand) }
      if (current.version !== change.expectedVersion) return { kind: 'version_conflict' }

      const nextTender = cloneTender(change.nextTender)
      nextTender.processedCommands[change.commandId] = structuredClone(change.command)
      tenders.set(change.tenderId, nextTender)
      return { kind: 'committed' }
    },

    async findDue(_input) {
      return []
    },
  }
}
