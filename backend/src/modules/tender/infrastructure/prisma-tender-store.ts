import type { CommandReceipt, TenderPhase } from '@anomaly-detector/contracts'
import type { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type {
  StoredTender,
  StoredTenderAuditEvent,
  StoredTenderCommand,
  TenderCommit,
  TenderCommitResult,
  TenderStore,
} from '../application/tender-store'

type PersistedTenderState = Pick<
  StoredTender,
  | 'accessSlots'
  | 'anomalyConfiguration'
  | 'budgetByPlayer'
  | 'corporateTrustByPlayer'
  | 'corporateReviewActive'
  | 'contractCompletedByPlayer'
  | 'contractPowerRestrictionsByPlayer'
  | 'finalScientificModelCompletedByPlayer'
  | 'finalScientificModelsByPlayer'
  | 'knownSignals'
  | 'powerAllocations'
  | 'publicContracts'
  | 'publicFinalContract'
  | 'publicLaboratoryResults'
  | 'publicScientificJournal'
  | 'publicTheses'
  | 'ratingByPlayer'
  | 'round'
  | 'rawTelemetrySignalsByPlayer'
  | 'laboratoryCompletedByPlayer'
  | 'modelAnalysisCompletedByPlayer'
  | 'privateMeasurementsByPlayer'
  | 'researchCertificationsByPlayer'
  | 'usedContractEvidenceTestIds'
  | 'privateWorkingModelsByPlayer'
  | 'reconnaissanceCompletedByPlayer'
  | 'requestedSlots'
  | 'samplesByPlayer'
  | 'winnerPlayerIds'
  | 'players'
>

const toPersistedState = (tender: StoredTender): PersistedTenderState => ({
  accessSlots: tender.accessSlots,
  anomalyConfiguration: tender.anomalyConfiguration,
  budgetByPlayer: tender.budgetByPlayer,
  corporateTrustByPlayer: tender.corporateTrustByPlayer,
  corporateReviewActive: tender.corporateReviewActive,
  contractCompletedByPlayer: tender.contractCompletedByPlayer,
  contractPowerRestrictionsByPlayer: tender.contractPowerRestrictionsByPlayer,
  finalScientificModelCompletedByPlayer: tender.finalScientificModelCompletedByPlayer,
  finalScientificModelsByPlayer: tender.finalScientificModelsByPlayer,
  knownSignals: tender.knownSignals,
  powerAllocations: tender.powerAllocations,
  publicContracts: tender.publicContracts,
  publicFinalContract: tender.publicFinalContract,
  publicLaboratoryResults: tender.publicLaboratoryResults,
  publicScientificJournal: tender.publicScientificJournal,
  publicTheses: tender.publicTheses,
  ratingByPlayer: tender.ratingByPlayer,
  round: tender.round,
  rawTelemetrySignalsByPlayer: tender.rawTelemetrySignalsByPlayer,
  laboratoryCompletedByPlayer: tender.laboratoryCompletedByPlayer,
  modelAnalysisCompletedByPlayer: tender.modelAnalysisCompletedByPlayer,
  privateMeasurementsByPlayer: tender.privateMeasurementsByPlayer,
  researchCertificationsByPlayer: tender.researchCertificationsByPlayer,
  usedContractEvidenceTestIds: tender.usedContractEvidenceTestIds,
  privateWorkingModelsByPlayer: tender.privateWorkingModelsByPlayer,
  reconnaissanceCompletedByPlayer: tender.reconnaissanceCompletedByPlayer,
  players: tender.players,
  requestedSlots: tender.requestedSlots,
  samplesByPlayer: tender.samplesByPlayer,
  winnerPlayerIds: tender.winnerPlayerIds,
})

const toStoredCommand = (record: { fingerprint: string; receipt: Prisma.JsonValue }): StoredTenderCommand => ({
  fingerprint: record.fingerprint,
  receipt: record.receipt as CommandReceipt,
})

const toStoredTender = (record: {
  dueAt: Date | null
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
    budgetByPlayer: state.budgetByPlayer ?? Object.fromEntries(state.players.map((player) => [player.id, 2])),
    corporateTrustByPlayer: state.corporateTrustByPlayer ?? Object.fromEntries(state.players.map((player) => [player.id, 0])),
    corporateReviewActive: state.corporateReviewActive ?? false,
    contractCompletedByPlayer: state.contractCompletedByPlayer ?? {},
    contractPowerRestrictionsByPlayer: state.contractPowerRestrictionsByPlayer ?? {},
    dueAt: record.dueAt,
    finalScientificModelCompletedByPlayer: state.finalScientificModelCompletedByPlayer ?? {},
    finalScientificModelsByPlayer: state.finalScientificModelsByPlayer ?? {},
    id: record.id,
    knownSignals: state.knownSignals ?? ['aster', 'boreal'],
    phase: record.phase as TenderPhase,
    powerAllocations: state.powerAllocations ?? {},
    publicContracts: state.publicContracts ?? createDefaultContracts(state.players.length),
    publicFinalContract: state.publicFinalContract ?? { contractId: 'final-contract', kind: 'final', ratingReward: 8, requiredPublicResult: 'reflection', requiredSecondaryPublicResult: 'attenuation', targetRole: 'source', targetSignal: 'ferro' },
    publicLaboratoryResults: state.publicLaboratoryResults ?? [],
    publicScientificJournal: state.publicScientificJournal ?? [],
    publicTheses: state.publicTheses ?? [],
    ratingByPlayer: state.ratingByPlayer ?? {},
    round: state.round ?? 1,
    rawTelemetrySignalsByPlayer: state.rawTelemetrySignalsByPlayer ?? {},
    laboratoryCompletedByPlayer: state.laboratoryCompletedByPlayer ?? {},
    modelAnalysisCompletedByPlayer: state.modelAnalysisCompletedByPlayer ?? {},
    privateMeasurementsByPlayer: state.privateMeasurementsByPlayer ?? {},
    researchCertificationsByPlayer: state.researchCertificationsByPlayer ?? {},
    usedContractEvidenceTestIds: state.usedContractEvidenceTestIds ?? [],
    privateWorkingModelsByPlayer: state.privateWorkingModelsByPlayer ?? {},
    reconnaissanceCompletedByPlayer: state.reconnaissanceCompletedByPlayer ?? {},
    players: state.players,
    requestedSlots: state.requestedSlots,
    samplesByPlayer: state.samplesByPlayer ?? {},
    processedCommands: Object.fromEntries(record.commands.map((command) => [command.commandId, toStoredCommand(command)])),
    version: record.version,
    winnerPlayerIds: state.winnerPlayerIds ?? [],
  }
}

const defaultContractSignalIds = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'] as const

function createDefaultContracts(playerCount: number) {
  const requiredPublicResults = ['reflection', 'attenuation', 'transmission_gain', 'unstable_collapse'] as const
  return Array.from({ length: playerCount + 1 }, (_, index) => ({
    contractId: `round-1-contract-${index + 1}`,
    requiredPublicResult: requiredPublicResults[index % requiredPublicResults.length],
    targetSignal: defaultContractSignalIds[index % defaultContractSignalIds.length],
    kind: index === 0 ? 'scientific' as const : index === 1 ? 'complex' as const : 'light' as const,
    ratingReward: index === 0 ? 3 : index === 1 ? 4 : 2,
    requiredSecondaryPublicResult: requiredPublicResults[(index + 1) % requiredPublicResults.length],
    targetRole: index % 2 === 0 ? 'source' as const : 'receiver' as const,
  }))
}

export function createPrismaTenderStore(db: DbClient): TenderStore {
  return {
    async anonymizeParticipant(playerId) {
      return db.$transaction(async (tx) => {
        const tenders = await tx.tender.findMany({
          where: {
            state: {
              path: ['players'],
              array_contains: [{ id: playerId }],
            },
          },
          select: { id: true, state: true, version: true },
        })
        const changedTenderIds: string[] = []
        for (const tender of tenders) {
          const state = tender.state as PersistedTenderState
          if (!state.players.some((player) => player.id === playerId && player.displayName !== 'Deleted participant')) continue
          const updated = await tx.tender.updateMany({
            where: { id: tender.id, version: tender.version },
            data: {
              state: {
                ...state,
                players: state.players.map((player) => player.id === playerId
                  ? { ...player, displayName: 'Deleted participant' }
                  : player),
              } as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          })
          if (updated.count === 0) throw new TenderVersionConflict()
          changedTenderIds.push(tender.id)
        }
        return changedTenderIds
      })
    },

    async create(tender) {
      const created = await db.tender.create({
        data: {
          version: tender.version,
          phase: tender.phase,
          dueAt: tender.dueAt,
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
          if (change.command && change.commandId) try {
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
              dueAt: change.nextTender.dueAt,
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

    async readAuditEvents(tenderId): Promise<StoredTenderAuditEvent[]> {
      const events = await db.tenderAuditEvent.findMany({
        where: { tenderId },
        orderBy: { sequence: 'asc' },
        select: { actorId: true, commandId: true, kind: true, payload: true, sequence: true },
      })
      return events.map((event) => ({
        ...(event.actorId ? { actorId: event.actorId } : {}),
        ...(event.commandId ? { commandId: event.commandId } : {}),
        kind: event.kind,
        payload: event.payload as Record<string, unknown>,
        sequence: event.sequence,
      }))
    },
  }
}

class TenderVersionConflict extends Error {}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
