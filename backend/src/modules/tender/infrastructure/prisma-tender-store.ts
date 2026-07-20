import type { CommandReceipt, TenderPhase } from '@the-game/contracts'
import type { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type {
  StoredTender,
  StoredTenderCommand,
  TenderCommit,
  TenderCommitResult,
  TenderStore,
} from '../application/tender-store'

type PersistedTenderState = Pick<StoredTender, 'requestedSlots' | 'teams'>

const toPersistedState = (tender: StoredTender): PersistedTenderState => ({
  teams: tender.teams,
  requestedSlots: tender.requestedSlots,
})

const toStoredCommand = (record: { fingerprint: string; receipt: Prisma.JsonValue }): StoredTenderCommand => ({
  fingerprint: record.fingerprint,
  receipt: record.receipt as CommandReceipt,
})

const toStoredTender = (record: {
  id: string
  phase: string
  state: Prisma.JsonValue
  version: number
  commands: Array<{ commandId: string; fingerprint: string; receipt: Prisma.JsonValue }>
}): StoredTender => {
  const state = record.state as PersistedTenderState
  return {
    id: record.id,
    phase: record.phase as TenderPhase,
    teams: state.teams,
    requestedSlots: state.requestedSlots,
    processedCommands: Object.fromEntries(record.commands.map((command) => [command.commandId, toStoredCommand(command)])),
    version: record.version,
  }
}

export function createPrismaTenderStore(db: DbClient): TenderStore {
  return {
    async create(tender) {
      const created = await db.tender.create({
        data: {
          version: tender.version,
          phase: tender.phase,
          state: toPersistedState({ ...tender, id: '' }) as Prisma.InputJsonValue,
        },
        include: { commands: true },
      })
      return toStoredTender(created)
    },

    async read(tenderId) {
      const tender = await db.tender.findUnique({
        where: { id: tenderId },
        include: { commands: true },
      })
      return tender ? toStoredTender(tender) : null
    },

    async commit(change: TenderCommit): Promise<TenderCommitResult> {
      try {
        return await db.$transaction<TenderCommitResult>(async (tx) => {
          try {
            await tx.tenderCommand.create({
              data: {
                tenderId: change.tenderId,
                commandId: change.commandId,
                fingerprint: change.command.fingerprint,
                receipt: change.command.receipt as Prisma.InputJsonValue,
              },
            })
          } catch (error) {
            if (!isUniqueConstraintError(error)) throw error
            const command = await tx.tenderCommand.findUniqueOrThrow({
              where: {
                tenderId_commandId: {
                  tenderId: change.tenderId,
                  commandId: change.commandId,
                },
              },
            })
            return { kind: 'command_exists', command: toStoredCommand(command) }
          }

          const updated = await tx.tender.updateMany({
            where: { id: change.tenderId, version: change.expectedVersion },
            data: {
              version: change.nextTender.version,
              phase: change.nextTender.phase,
              state: toPersistedState(change.nextTender) as Prisma.InputJsonValue,
            },
          })
          if (updated.count === 0) {
            throw new TenderVersionConflict()
          }

          if (change.auditEvents.length > 0) {
            const latestAuditEvent = await tx.tenderAuditEvent.findFirst({
              where: { tenderId: change.tenderId },
              orderBy: { sequence: 'desc' },
              select: { sequence: true },
            })
            await tx.tenderAuditEvent.createMany({
              data: change.auditEvents.map((event, index) => ({
                tenderId: change.tenderId,
                sequence: (latestAuditEvent?.sequence ?? 0) + index + 1,
                actorId: event.actorId,
                commandId: event.commandId,
                kind: event.kind,
                payload: event.payload as Prisma.InputJsonValue,
              })),
            })
          }
          return { kind: 'committed' }
        })
      } catch (error) {
        if (error instanceof TenderVersionConflict) return { kind: 'version_conflict' }
        throw error
      }
    },

    async findDue({ limit, now }) {
      const tenders = await db.tender.findMany({
        where: { dueAt: { lte: now } },
        orderBy: { dueAt: 'asc' },
        take: limit,
        select: { id: true },
      })
      return tenders.map((tender) => tender.id)
    },
  }
}

class TenderVersionConflict extends Error {}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
