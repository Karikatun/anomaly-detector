import type {
  TenderCommit,
  TenderCommitResult,
  TenderStore,
  StoredTender,
  StoredTenderAuditEvent,
} from '../application/tender-store'
import {
  decodeTenderAuditEvent,
  encodeTenderAuditEventPayload,
} from '../application/tender-audit-event'
import {
  tenderCommandLookupIds,
  tenderDeletedCommandId,
  tenderStorageCommandId,
} from '../application/tender-command-identity'
import { anonymizeParticipantInValue } from '../domain/participant-anonymization'

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
        if (!tender.players.some((player) => player.id === playerId)) continue
        const anonymousPlayerId = `deleted-participant-${crypto.randomUUID()}`
        const anonymized = anonymizeParticipantInValue(tender, playerId, anonymousPlayerId)
        const processedCommands = Object.fromEntries(
          Object.entries(tender.processedCommands).map(([commandId, command]) => [
            commandId.includes(playerId) ? tenderDeletedCommandId(commandId) : commandId,
            anonymizeParticipantInValue(command, playerId, anonymousPlayerId),
          ]),
        )
        tenders.set(tenderId, {
          ...anonymized,
          players: anonymized.players.map((player) => player.id === anonymousPlayerId
            ? { ...player, displayName: 'Deleted participant' }
            : player),
          processedCommands,
          version: tender.version + 1,
        })
        auditEvents.set(
          tenderId,
          (auditEvents.get(tenderId) ?? []).map((event) => {
            const anonymizedEvent = anonymizeParticipantInValue(
              event,
              playerId,
              anonymousPlayerId,
            )
            return event.commandId?.includes(playerId)
              ? { ...anonymizedEvent, commandId: tenderDeletedCommandId(event.commandId) }
              : anonymizedEvent
          }),
        )
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

    async findCommand({ commandId, tenderId }) {
      const tender = tenders.get(tenderId)
      if (!tender) return null
      for (const candidateCommandId of tenderCommandLookupIds(commandId)) {
        const command = tender.processedCommands[candidateCommandId]
        if (command) return structuredClone(command)
      }
      return null
    },

    async commit(change: TenderCommit): Promise<TenderCommitResult> {
      const current = readCurrentTender(change.tenderId)
      const previousCommand = change.commandId
        ? tenderCommandLookupIds(change.commandId)
          .map((commandId) => current.processedCommands[commandId])
          .find((command) => command !== undefined)
        : undefined
      if (previousCommand) return { kind: 'command_exists', command: structuredClone(previousCommand) }
      if (current.version !== change.expectedVersion) return { kind: 'version_conflict' }

      const nextTender = cloneTender(change.nextTender)
      if (change.commandId && change.command) {
        nextTender.processedCommands[tenderStorageCommandId(change.commandId)] = structuredClone(change.command)
      }
      tenders.set(change.tenderId, nextTender)
      const currentEvents = auditEvents.get(change.tenderId) ?? []
      auditEvents.set(change.tenderId, [
        ...currentEvents,
        ...change.auditEvents.map((event, index) => {
          const storedEvent = event.commandId
            ? { ...event, commandId: tenderStorageCommandId(event.commandId) }
            : event
          return decodeTenderAuditEvent({
            ...storedEvent,
            payload: encodeTenderAuditEventPayload(storedEvent),
            sequence: currentEvents.length + index + 1,
          })
        }),
      ])
      return { kind: 'committed' }
    },

    async findDue({ limit, now }) {
      return [...tenders.values()]
        .filter((tender) =>
          (tender.dueAt !== null && tender.dueAt <= now)
          || (tender.abandonmentDueAt !== null && tender.abandonmentDueAt <= now))
        .sort((left, right) => earliestDeadline(left).getTime() - earliestDeadline(right).getTime())
        .slice(0, limit)
        .map((tender) => tender.id)
    },

    async findBotTenders({ afterId, limit }) {
      return [...tenders.values()]
        .filter((tender) => tender.phase !== 'complete'
          && tender.players.some((player) => player.bot)
          && (afterId === undefined || tender.id > afterId))
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
        .slice(0, limit)
        .map((tender) => tender.id)
    },

    async listCompletedForPlayer(playerId) {
      return [...tenders.values()]
        .filter((tender) =>
          tender.phase === 'complete'
          && tender.players.some((player) => player.id === playerId))
        .map(cloneTender)
    },

    async readAuditEvents(tenderId) {
      return structuredClone(auditEvents.get(tenderId) ?? [])
    },
  }
}

function earliestDeadline(tender: StoredTender) {
  const deadlines = [tender.dueAt, tender.abandonmentDueAt].filter((value): value is Date => value !== null)
  return new Date(Math.min(...deadlines.map((deadline) => deadline.getTime())))
}
