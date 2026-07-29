import {
  anomalyConfigurationSchema,
  commandReceiptSchema,
  playerIdSchema,
  powerAllocationSchema,
  privateMeasurementSchema,
  privateThesisSchema,
  publicContractSchema,
  publicLaboratoryResultSchema,
  publicThesisSchema,
  scientificJournalEntrySchema,
  scientificModelSchema,
  scientificModelDraftSchema,
  signalIdSchema,
  tenderPhaseSchema,
  tenderPlayerSchema,
  tenderRulesetSchema,
  workingModelSchema,
} from '@anomaly-detector/contracts'
import { z } from 'zod'
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
import {
  anonymizeParticipantInJsonString,
  anonymizeParticipantInValue,
} from '../domain/participant-anonymization'

type PersistedTenderState = Pick<
  StoredTender,
  | 'accessSlots'
  | 'anomalyConfiguration'
  | 'budgetByPlayer'
  | 'corporateTrustByPlayer'
  | 'corporateReviewActive'
  | 'corporateReviewByPlayer'
  | 'contractCompletedByPlayer'
  | 'contractPowerRestrictionsByPlayer'
  | 'completionReason'
  | 'departedPlayerIds'
  | 'finalScientificModelCompletedByPlayer'
  | 'finalScientificModelDraftsByPlayer'
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
  | 'ruleset'
  | 'rawTelemetrySignalsByPlayer'
  | 'laboratoryCompletedByPlayer'
  | 'modelAnalysisCompletedByPlayer'
  | 'privateMeasurementsByPlayer'
  | 'privateThesesByPlayer'
  | 'certifiedSignalsByPlayer'
  | 'researchCertificationsByPlayer'
  | 'usedContractEvidenceTestIds'
  | 'privateWorkingModelsByPlayer'
  | 'reconnaissanceCompletedByPlayer'
  | 'requestedSlots'
  | 'samplesByPlayer'
  | 'winnerPlayerIds'
  | 'players'
>

const playerIntegerRecordSchema = z.record(playerIdSchema, z.number().int())
const playerBooleanRecordSchema = z.record(playerIdSchema, z.boolean())
const persistedTenderStateSchema = z.object({
  accessSlots: z.record(playerIdSchema, z.number().int().min(1).max(6)),
  anomalyConfiguration: anomalyConfigurationSchema,
  budgetByPlayer: playerIntegerRecordSchema.optional(),
  corporateTrustByPlayer: z.record(playerIdSchema, z.number().int().min(0)).optional(),
  corporateReviewActive: z.boolean().optional(),
  corporateReviewByPlayer: playerBooleanRecordSchema.optional(),
  certifiedSignalsByPlayer: z.record(playerIdSchema, z.array(signalIdSchema)).optional(),
  contractCompletedByPlayer: playerBooleanRecordSchema.optional(),
  contractPowerRestrictionsByPlayer: z.record(playerIdSchema, z.number().int().min(0).max(1)).optional(),
  completionReason: z.literal('all_players_left').optional(),
  departedPlayerIds: z.array(playerIdSchema).optional(),
  finalScientificModelCompletedByPlayer: playerBooleanRecordSchema.optional(),
  finalScientificModelDraftsByPlayer: z.record(playerIdSchema, scientificModelDraftSchema).optional(),
  finalScientificModelsByPlayer: z.record(playerIdSchema, scientificModelSchema).optional(),
  knownSignals: z.array(signalIdSchema).optional(),
  powerAllocations: z.record(playerIdSchema, powerAllocationSchema).optional(),
  privateMeasurementsByPlayer: z.record(playerIdSchema, z.array(privateMeasurementSchema)).optional(),
  privateThesesByPlayer: z.record(playerIdSchema, z.array(privateThesisSchema)).optional(),
  privateWorkingModelsByPlayer: z.record(playerIdSchema, workingModelSchema).optional(),
  publicContracts: z.array(publicContractSchema).optional(),
  publicFinalContract: publicContractSchema.optional(),
  publicLaboratoryResults: z.array(publicLaboratoryResultSchema).optional(),
  publicScientificJournal: z.array(scientificJournalEntrySchema).optional(),
  publicTheses: z.array(publicThesisSchema).optional(),
  ratingByPlayer: z.record(playerIdSchema, z.number().int().min(0)).optional(),
  rawTelemetrySignalsByPlayer: z.record(playerIdSchema, z.array(signalIdSchema)).optional(),
  laboratoryCompletedByPlayer: playerBooleanRecordSchema.optional(),
  modelAnalysisCompletedByPlayer: playerBooleanRecordSchema.optional(),
  players: z.array(tenderPlayerSchema).min(2).max(4),
  reconnaissanceCompletedByPlayer: playerBooleanRecordSchema.optional(),
  requestedSlots: z.record(playerIdSchema, z.number().int().min(1).max(6)),
  researchCertificationsByPlayer: z.record(playerIdSchema, z.array(signalIdSchema)).optional(),
  round: z.number().int().min(1).max(5).optional(),
  ruleset: tenderRulesetSchema.optional(),
  samplesByPlayer: z.record(playerIdSchema, z.array(signalIdSchema)).optional(),
  usedContractEvidenceTestIds: z.array(z.string().min(1).max(128)).optional(),
  winnerPlayerIds: z.array(playerIdSchema).optional(),
}).passthrough()

const toPersistedState = (tender: StoredTender): PersistedTenderState => ({
  accessSlots: tender.accessSlots,
  anomalyConfiguration: tender.anomalyConfiguration,
  budgetByPlayer: tender.budgetByPlayer,
  corporateTrustByPlayer: tender.corporateTrustByPlayer,
  corporateReviewActive: tender.corporateReviewActive,
  corporateReviewByPlayer: tender.corporateReviewByPlayer,
  certifiedSignalsByPlayer: tender.certifiedSignalsByPlayer,
  contractCompletedByPlayer: tender.contractCompletedByPlayer,
  contractPowerRestrictionsByPlayer: tender.contractPowerRestrictionsByPlayer,
  ...(tender.completionReason ? { completionReason: tender.completionReason } : {}),
  departedPlayerIds: tender.departedPlayerIds,
  finalScientificModelCompletedByPlayer: tender.finalScientificModelCompletedByPlayer,
  finalScientificModelDraftsByPlayer: tender.finalScientificModelDraftsByPlayer,
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
  ruleset: tender.ruleset,
  rawTelemetrySignalsByPlayer: tender.rawTelemetrySignalsByPlayer,
  laboratoryCompletedByPlayer: tender.laboratoryCompletedByPlayer,
  modelAnalysisCompletedByPlayer: tender.modelAnalysisCompletedByPlayer,
  privateMeasurementsByPlayer: tender.privateMeasurementsByPlayer,
  privateThesesByPlayer: tender.privateThesesByPlayer,
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
  receipt: commandReceiptSchema.parse(record.receipt),
})

const toStoredTender = (record: {
  abandonmentDueAt: Date | null
  dueAt: Date | null
  id: string
  phase: string
  state: Prisma.JsonValue
  version: number
  commands: Array<{ commandId: string; fingerprint: string; receipt: Prisma.JsonValue }>
}): StoredTender => {
  const state = persistedTenderStateSchema.parse(record.state)
  const publicContracts = state.publicContracts ?? createDefaultContracts(state.players.length)
  const publicFinalContract = state.publicFinalContract ?? { contractId: 'final-contract', kind: 'final', ratingReward: 8, requiredPublicResult: 'reflection', requiredSecondaryPublicResult: 'attenuation', targetRole: 'source', targetSignal: 'ferro' }
  return {
    accessSlots: state.accessSlots,
    abandonmentDueAt: record.abandonmentDueAt,
    anomalyConfiguration: state.anomalyConfiguration,
    budgetByPlayer: state.budgetByPlayer ?? Object.fromEntries(state.players.map((player) => [player.id, 2])),
    corporateTrustByPlayer: state.corporateTrustByPlayer ?? Object.fromEntries(state.players.map((player) => [player.id, 0])),
    corporateReviewActive: state.corporateReviewActive ?? false,
    corporateReviewByPlayer: state.corporateReviewByPlayer ?? {},
    certifiedSignalsByPlayer: state.certifiedSignalsByPlayer ?? {},
    contractCompletedByPlayer: state.contractCompletedByPlayer ?? {},
    contractPowerRestrictionsByPlayer: state.contractPowerRestrictionsByPlayer ?? {},
    ...(state.completionReason ? { completionReason: state.completionReason } : {}),
    departedPlayerIds: state.departedPlayerIds ?? [],
    dueAt: record.dueAt,
    finalScientificModelCompletedByPlayer: state.finalScientificModelCompletedByPlayer ?? {},
    finalScientificModelDraftsByPlayer: state.finalScientificModelDraftsByPlayer ?? {},
    finalScientificModelsByPlayer: state.finalScientificModelsByPlayer ?? {},
    id: record.id,
    knownSignals: state.knownSignals ?? [
      ...new Set(
        [...publicContracts.map((contract) => contract.targetSignal), publicFinalContract.targetSignal]
          .filter((signal): signal is NonNullable<typeof signal> => signal !== undefined),
      ),
    ],
    phase: tenderPhaseSchema.parse(record.phase),
    powerAllocations: state.powerAllocations ?? {},
    publicContracts,
    publicFinalContract,
    publicLaboratoryResults: state.publicLaboratoryResults ?? [],
    publicScientificJournal: state.publicScientificJournal ?? [],
    publicTheses: state.publicTheses ?? [],
    ratingByPlayer: state.ratingByPlayer ?? {},
    round: state.round ?? 1,
    ruleset: state.ruleset ?? 'tender-v1',
    rawTelemetrySignalsByPlayer: state.rawTelemetrySignalsByPlayer ?? {},
    laboratoryCompletedByPlayer: state.laboratoryCompletedByPlayer ?? {},
    modelAnalysisCompletedByPlayer: state.modelAnalysisCompletedByPlayer ?? {},
    privateMeasurementsByPlayer: state.privateMeasurementsByPlayer ?? {},
    privateThesesByPlayer: state.privateThesesByPlayer ?? {},
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
          const state = persistedTenderStateSchema.parse(tender.state)
          if (!state.players.some((player) => player.id === playerId && player.displayName !== 'Deleted participant')) continue
          const anonymousPlayerId = `deleted-participant-${crypto.randomUUID()}`
          const anonymizedState = anonymizeParticipantInValue(
            state,
            playerId,
            anonymousPlayerId,
          )
          const updated = await tx.tender.updateMany({
            where: { id: tender.id, version: tender.version },
            data: {
              state: {
                ...anonymizedState,
                players: anonymizedState.players.map((player) => player.id === anonymousPlayerId
                  ? { ...player, displayName: 'Deleted participant' }
                  : player),
              } as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          })
          if (updated.count === 0) throw new TenderVersionConflict()
          const auditEvents = await tx.tenderAuditEvent.findMany({
            where: { tenderId: tender.id },
            select: { actorId: true, id: true, payload: true },
          })
          for (const event of auditEvents) {
            await tx.tenderAuditEvent.update({
              where: { id: event.id },
              data: {
                actorId: event.actorId === playerId ? anonymousPlayerId : event.actorId,
                payload: anonymizeParticipantInValue(
                  event.payload,
                  playerId,
                  anonymousPlayerId,
                ) as Prisma.InputJsonValue,
              },
            })
          }
          const commands = await tx.tenderCommand.findMany({
            where: { tenderId: tender.id },
            select: { fingerprint: true, id: true, receipt: true },
          })
          for (const command of commands) {
            await tx.tenderCommand.update({
              where: { id: command.id },
              data: {
                fingerprint: anonymizeParticipantInJsonString(
                  command.fingerprint,
                  playerId,
                  anonymousPlayerId,
                ),
                receipt: anonymizeParticipantInValue(
                  command.receipt,
                  playerId,
                  anonymousPlayerId,
                ) as Prisma.InputJsonValue,
              },
            })
          }
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
          abandonmentDueAt: tender.abandonmentDueAt,
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
              abandonmentDueAt: change.nextTender.abandonmentDueAt,
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
        where: {
          OR: [
            { dueAt: { lte: now } },
            { abandonmentDueAt: { lte: now } },
          ],
        },
        take: limit * 2,
        select: { abandonmentDueAt: true, dueAt: true, id: true },
      })
      return tenders
        .sort((left, right) => earliestDeadline(left).getTime() - earliestDeadline(right).getTime())
        .slice(0, limit)
        .map((tender) => tender.id)
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

function earliestDeadline(tender: { abandonmentDueAt: Date | null; dueAt: Date | null }) {
  const deadlines = [tender.dueAt, tender.abandonmentDueAt].filter((value): value is Date => value !== null)
  return new Date(Math.min(...deadlines.map((deadline) => deadline.getTime())))
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
