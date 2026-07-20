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

type PersistedTenderState = Pick<
  StoredTender,
  | 'accessSlots'
  | 'anomalyConfiguration'
  | 'contractPowerRestrictionsByPlayer'
  | 'knownSignals'
  | 'powerAllocations'
  | 'publicContracts'
  | 'publicLaboratoryResults'
  | 'publicTheses'
  | 'ratingByPlayer'
  | 'rawTelemetrySignalsByPlayer'
  | 'laboratoryCompletedByPlayer'
  | 'modelAnalysisCompletedByPlayer'
  | 'privateMeasurementsByPlayer'
  | 'reconnaissanceCompletedByPlayer'
  | 'requestedSlots'
  | 'samplesByPlayer'
  | 'players'
>

const toPersistedState = (tender: StoredTender): PersistedTenderState => ({
  accessSlots: tender.accessSlots,
  anomalyConfiguration: tender.anomalyConfiguration,
  contractPowerRestrictionsByPlayer: tender.contractPowerRestrictionsByPlayer,
  knownSignals: tender.knownSignals,
  powerAllocations: tender.powerAllocations,
  publicContracts: tender.publicContracts,
  publicLaboratoryResults: tender.publicLaboratoryResults,
  publicTheses: tender.publicTheses,
  ratingByPlayer: tender.ratingByPlayer,
  rawTelemetrySignalsByPlayer: tender.rawTelemetrySignalsByPlayer,
  laboratoryCompletedByPlayer: tender.laboratoryCompletedByPlayer,
  modelAnalysisCompletedByPlayer: tender.modelAnalysisCompletedByPlayer,
  privateMeasurementsByPlayer: tender.privateMeasurementsByPlayer,
  reconnaissanceCompletedByPlayer: tender.reconnaissanceCompletedByPlayer,
  players: tender.players,
  requestedSlots: tender.requestedSlots,
  samplesByPlayer: tender.samplesByPlayer,
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
    accessSlots: state.accessSlots,
    anomalyConfiguration: state.anomalyConfiguration,
    contractPowerRestrictionsByPlayer: state.contractPowerRestrictionsByPlayer ?? {},
    id: record.id,
    knownSignals: state.knownSignals ?? ['aster', 'boreal'],
    phase: record.phase as TenderPhase,
    powerAllocations: state.powerAllocations ?? {},
    publicContracts: state.publicContracts ?? createDefaultContracts(state.players.length),
    publicLaboratoryResults: state.publicLaboratoryResults ?? [],
    publicTheses: state.publicTheses ?? [],
    ratingByPlayer: state.ratingByPlayer ?? {},
    rawTelemetrySignalsByPlayer: state.rawTelemetrySignalsByPlayer ?? {},
    laboratoryCompletedByPlayer: state.laboratoryCompletedByPlayer ?? {},
    modelAnalysisCompletedByPlayer: state.modelAnalysisCompletedByPlayer ?? {},
    privateMeasurementsByPlayer: state.privateMeasurementsByPlayer ?? {},
    reconnaissanceCompletedByPlayer: state.reconnaissanceCompletedByPlayer ?? {},
    players: state.players,
    requestedSlots: state.requestedSlots,
    samplesByPlayer: state.samplesByPlayer ?? {},
    processedCommands: Object.fromEntries(record.commands.map((command) => [command.commandId, toStoredCommand(command)])),
    version: record.version,
  }
}

function createDefaultContracts(playerCount: number) {
  const requiredPublicResults = ['reflection', 'attenuation', 'transmission_gain', 'unstable_collapse'] as const
  return Array.from({ length: playerCount + 1 }, (_, index) => ({
    contractId: `round-1-contract-${index + 1}`,
    requiredPublicResult: requiredPublicResults[index % requiredPublicResults.length],
  }))
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
