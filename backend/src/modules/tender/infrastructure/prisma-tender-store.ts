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
import type { DbClient, DbTransaction } from '../../../db'
import { lockActiveAccountLifecycleTransaction } from '../../../security/account-lifecycle-lock'
import type {
  StoredTender,
  StoredTenderAuditEvent,
  StoredTenderCommand,
  TenderCommit,
  TenderCommitResult,
  TenderStore,
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
import {
  anonymizeParticipantInValue,
  embeddedParticipantPseudonym,
} from '../domain/participant-anonymization'

type PersistedTenderState = Pick<
  StoredTender,
  | 'accessSlots'
  | 'anomalyConfiguration'
  | 'automaticOperationalSkipsByPlayer'
  | 'budgetByPlayer'
  | 'corporateTrustByPlayer'
  | 'corporateReviewActive'
  | 'corporateReviewByPlayer'
  | 'contractDeckVersion'
  | 'contractCompletedByPlayer'
  | 'contractPowerRestrictionsByPlayer'
  | 'completionReason'
  | 'departedPlayerIds'
  | 'finalScientificModelCompletedByPlayer'
  | 'finalScientificModelDraftsByPlayer'
  | 'finalScientificModelsByPlayer'
  | 'finalScientificModelSubmittedAtByPlayer'
  | 'forfeitedAtByPlayer'
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
const automaticOperationalSkipSchema = z.object({
  phase: z.enum(['laboratory', 'reconnaissance']),
  reason: z.enum(['all_pairs_researched', 'all_samples_collected', 'insufficient_samples']),
  round: z.number().int().min(1).max(5),
}).strict()
const persistedTenderStateSchema = z.object({
  accessSlots: z.record(playerIdSchema, z.number().int().min(1).max(6)),
  anomalyConfiguration: anomalyConfigurationSchema,
  automaticOperationalSkipsByPlayer: z.record(playerIdSchema, automaticOperationalSkipSchema).optional(),
  budgetByPlayer: playerIntegerRecordSchema.optional(),
  corporateTrustByPlayer: z.record(playerIdSchema, z.number().int().min(0)).optional(),
  corporateReviewActive: z.boolean().optional(),
  corporateReviewByPlayer: playerBooleanRecordSchema.optional(),
  contractDeckVersion: z.enum(['legacy-v1', 'varied-v2']).optional(),
  certifiedSignalsByPlayer: z.record(playerIdSchema, z.array(signalIdSchema)).optional(),
  contractCompletedByPlayer: playerBooleanRecordSchema.optional(),
  contractPowerRestrictionsByPlayer: z.record(playerIdSchema, z.number().int().min(0).max(1)).optional(),
  completionReason: z.enum(['all_players_left', 'last_active_player', 'all_players_forfeited']).optional(),
  departedPlayerIds: z.array(playerIdSchema).optional(),
  finalScientificModelCompletedByPlayer: playerBooleanRecordSchema.optional(),
  finalScientificModelDraftsByPlayer: z.record(playerIdSchema, scientificModelDraftSchema).optional(),
  finalScientificModelsByPlayer: z.record(playerIdSchema, scientificModelSchema).optional(),
  finalScientificModelSubmittedAtByPlayer: z.record(playerIdSchema, z.string().datetime()).optional(),
  forfeitedAtByPlayer: z.record(playerIdSchema, z.string().datetime()).optional(),
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
  automaticOperationalSkipsByPlayer: tender.automaticOperationalSkipsByPlayer,
  budgetByPlayer: tender.budgetByPlayer,
  corporateTrustByPlayer: tender.corporateTrustByPlayer,
  corporateReviewActive: tender.corporateReviewActive,
  corporateReviewByPlayer: tender.corporateReviewByPlayer,
  contractDeckVersion: tender.contractDeckVersion,
  certifiedSignalsByPlayer: tender.certifiedSignalsByPlayer,
  contractCompletedByPlayer: tender.contractCompletedByPlayer,
  contractPowerRestrictionsByPlayer: tender.contractPowerRestrictionsByPlayer,
  ...(tender.completionReason ? { completionReason: tender.completionReason } : {}),
  departedPlayerIds: tender.departedPlayerIds,
  finalScientificModelCompletedByPlayer: tender.finalScientificModelCompletedByPlayer,
  finalScientificModelDraftsByPlayer: tender.finalScientificModelDraftsByPlayer,
  finalScientificModelsByPlayer: tender.finalScientificModelsByPlayer,
  finalScientificModelSubmittedAtByPlayer: tender.finalScientificModelSubmittedAtByPlayer,
  forfeitedAtByPlayer: tender.forfeitedAtByPlayer,
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

const findStoredCommandByLookupOrder = (
  records: Array<{ commandId: string; fingerprint: string; receipt: Prisma.JsonValue }>,
  commandIds: string[],
) => {
  const recordsByCommandId = new Map(records.map((record) => [record.commandId, record]))
  const record = commandIds.map((commandId) => recordsByCommandId.get(commandId)).find((candidate) => candidate !== undefined)
  return record ? toStoredCommand(record) : null
}

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
    automaticOperationalSkipsByPlayer: state.automaticOperationalSkipsByPlayer ?? {},
    budgetByPlayer: state.budgetByPlayer ?? Object.fromEntries(state.players.map((player) => [player.id, 2])),
    corporateTrustByPlayer: state.corporateTrustByPlayer ?? Object.fromEntries(state.players.map((player) => [player.id, 0])),
    corporateReviewActive: state.corporateReviewActive ?? false,
    corporateReviewByPlayer: state.corporateReviewByPlayer ?? {},
    contractDeckVersion: state.contractDeckVersion ?? 'legacy-v1',
    certifiedSignalsByPlayer: state.certifiedSignalsByPlayer ?? {},
    contractCompletedByPlayer: state.contractCompletedByPlayer ?? {},
    contractPowerRestrictionsByPlayer: state.contractPowerRestrictionsByPlayer ?? {},
    ...(state.completionReason ? { completionReason: state.completionReason } : {}),
    departedPlayerIds: state.departedPlayerIds ?? [],
    dueAt: record.dueAt,
    finalScientificModelCompletedByPlayer: state.finalScientificModelCompletedByPlayer ?? {},
    finalScientificModelDraftsByPlayer: state.finalScientificModelDraftsByPlayer ?? {},
    finalScientificModelsByPlayer: state.finalScientificModelsByPlayer ?? {},
    finalScientificModelSubmittedAtByPlayer: state.finalScientificModelSubmittedAtByPlayer ?? {},
    forfeitedAtByPlayer: state.forfeitedAtByPlayer ?? {},
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

export async function anonymizePrismaTenderParticipant(
  tx: DbTransaction,
  playerId: string,
) {
  const changedTenderIds: string[] = []
  while (true) {
    const batch = await anonymizePrismaTenderParticipantBatchInternal(tx, playerId, 25)
    changedTenderIds.push(...batch.changedTenderIds)
    if (!batch.hasMore) return changedTenderIds
  }
}

export async function anonymizePrismaTenderParticipantBatch(
  tx: DbTransaction,
  playerId: string,
) {
  return anonymizePrismaTenderParticipantBatchInternal(tx, playerId, 1)
}

async function anonymizePrismaTenderParticipantBatchInternal(
  tx: DbTransaction,
  playerId: string,
  tenderLimit: number,
) {
  const participantFilter = JSON.stringify({ players: [{ id: playerId }] })
  const candidates = await tx.$queryRaw<Array<{
    id: string
    state: Prisma.JsonValue
    version: number
  }>>`
    SELECT "id", "state", "version"
    FROM "tenders"
    WHERE "state" @> ${participantFilter}::jsonb
    LIMIT ${tenderLimit + 1}
  `
  const tenders = candidates.slice(0, tenderLimit)
  if (tenders.length === 0) {
    return { changedTenderIds: [], hasMore: false }
  }

  const changedTenderIds: string[] = []
  const replacements: Array<{
    anonymousPlayerId: string
    anonymousPlayerIdJson: string
    embeddedPlayerId: string
    identityMarkerJson: string
    playerId: string
    playerIdJson: string
    tenderId: string
  }> = []
  for (const tender of tenders) {
    const state = persistedTenderStateSchema.parse(tender.state)
    if (!state.players.some((player) => player.id === playerId)) {
      throw new Error('Tender participant lookup returned an inconsistent state')
    }
    const anonymousPlayerId = `deleted-participant-${crypto.randomUUID()}`
    const anonymizedState = anonymizeParticipantInValue(
      state,
      playerId,
      anonymousPlayerId,
    )
    const validatedAnonymizedState = persistedTenderStateSchema.parse({
      ...anonymizedState,
      players: anonymizedState.players.map((player) => player.id === anonymousPlayerId
        ? { ...player, displayName: 'Deleted participant' }
        : player),
    })
    const updated = await tx.tender.updateMany({
      where: { id: tender.id, version: tender.version },
      data: {
        state: validatedAnonymizedState as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    })
    if (updated.count === 0) throw new TenderVersionConflict()
    changedTenderIds.push(tender.id)
    replacements.push({
      anonymousPlayerId,
      anonymousPlayerIdJson: JSON.stringify(anonymousPlayerId),
      embeddedPlayerId: embeddedParticipantPseudonym(playerId, anonymousPlayerId),
      identityMarkerJson: JSON.stringify(`participant-identity-marker-${crypto.randomUUID()}`),
      playerId,
      playerIdJson: JSON.stringify(playerId),
      tenderId: tender.id,
    })
  }

  if (replacements.length > 0) {
    const replacementsJson = JSON.stringify(replacements)
    const commandKeys = await tx.$queryRaw<Array<{
      commandId: string
      tenderId: string
    }>>`
      SELECT command."command_id" AS "commandId", command."tender_id"::text AS "tenderId"
      FROM "tender_commands" AS command
      JOIN jsonb_to_recordset(${replacementsJson}::jsonb) AS replacement(
        "tenderId" uuid,
        "playerId" text,
        "anonymousPlayerId" text,
        "embeddedPlayerId" text,
        "playerIdJson" text,
        "anonymousPlayerIdJson" text,
        "identityMarkerJson" text
      ) ON command."tender_id" = replacement."tenderId"
      WHERE strpos(command."command_id", replacement."playerId") > 0
      UNION
      SELECT event."command_id" AS "commandId", event."tender_id"::text AS "tenderId"
      FROM "tender_audit_events" AS event
      JOIN jsonb_to_recordset(${replacementsJson}::jsonb) AS replacement(
        "tenderId" uuid,
        "playerId" text,
        "anonymousPlayerId" text,
        "embeddedPlayerId" text,
        "playerIdJson" text,
        "anonymousPlayerIdJson" text,
        "identityMarkerJson" text
      ) ON event."tender_id" = replacement."tenderId"
      WHERE event."command_id" IS NOT NULL
        AND strpos(event."command_id", replacement."playerId") > 0
    `
    const commandKeyReplacements = commandKeys.map(({ commandId, tenderId }) => ({
      anonymizedCommandId: tenderDeletedCommandId(commandId),
      commandId,
      tenderId,
    }))
    await tx.$executeRaw`
      UPDATE "tender_audit_events" AS event
      SET
        "actor_id" = CASE
          WHEN event."actor_id" = replacement."playerId"
            THEN replacement."anonymousPlayerId"
          ELSE event."actor_id"
        END,
        "payload" = replace(
          replace(
            replace(
              event."payload"::text,
              replacement."playerIdJson",
              replacement."identityMarkerJson"
            ),
            replacement."playerId",
            replacement."embeddedPlayerId"
          ),
          replacement."identityMarkerJson",
          replacement."anonymousPlayerIdJson"
        )::jsonb
      FROM jsonb_to_recordset(${replacementsJson}::jsonb) AS replacement(
        "tenderId" uuid,
        "playerId" text,
        "anonymousPlayerId" text,
        "embeddedPlayerId" text,
        "playerIdJson" text,
        "anonymousPlayerIdJson" text,
        "identityMarkerJson" text
      )
      WHERE event."tender_id" = replacement."tenderId"
        AND (
          event."actor_id" = replacement."playerId"
          OR strpos(event."payload"::text, replacement."playerId") > 0
        )
    `
    await tx.$executeRaw`
      UPDATE "tender_commands" AS command
      SET
        "fingerprint" = replace(
          replace(
            replace(
              command."fingerprint",
              replacement."playerIdJson",
              replacement."identityMarkerJson"
            ),
            replacement."playerId",
            replacement."embeddedPlayerId"
          ),
          replacement."identityMarkerJson",
          replacement."anonymousPlayerIdJson"
        ),
        "receipt" = replace(
          replace(
            replace(
              command."receipt"::text,
              replacement."playerIdJson",
              replacement."identityMarkerJson"
            ),
            replacement."playerId",
            replacement."embeddedPlayerId"
          ),
          replacement."identityMarkerJson",
          replacement."anonymousPlayerIdJson"
        )::jsonb
      FROM jsonb_to_recordset(${replacementsJson}::jsonb) AS replacement(
        "tenderId" uuid,
        "playerId" text,
        "anonymousPlayerId" text,
        "embeddedPlayerId" text,
        "playerIdJson" text,
        "anonymousPlayerIdJson" text,
        "identityMarkerJson" text
      )
      WHERE command."tender_id" = replacement."tenderId"
        AND (
          command."fingerprint"::jsonb ->> 'actorId' = replacement."playerId"
          OR strpos(command."fingerprint", replacement."playerId") > 0
          OR strpos(command."receipt"::text, replacement."playerId") > 0
        )
    `
    if (commandKeyReplacements.length > 0) {
      const commandKeyReplacementsJson = JSON.stringify(commandKeyReplacements)
      await tx.$executeRaw`
        UPDATE "tender_commands" AS command
        SET "command_id" = replacement."anonymizedCommandId"
        FROM jsonb_to_recordset(${commandKeyReplacementsJson}::jsonb) AS replacement(
          "tenderId" uuid,
          "commandId" text,
          "anonymizedCommandId" text
        )
        WHERE command."tender_id" = replacement."tenderId"
          AND command."command_id" = replacement."commandId"
      `
      await tx.$executeRaw`
        UPDATE "tender_audit_events" AS event
        SET "command_id" = replacement."anonymizedCommandId"
        FROM jsonb_to_recordset(${commandKeyReplacementsJson}::jsonb) AS replacement(
          "tenderId" uuid,
          "commandId" text,
          "anonymizedCommandId" text
        )
        WHERE event."tender_id" = replacement."tenderId"
          AND event."command_id" = replacement."commandId"
      `
    }
  }

  return { changedTenderIds, hasMore: candidates.length > tenderLimit }
}

export function createPrismaTenderStore(
  db: DbClient,
  accountLifecycleSecret?: string,
): TenderStore {
  return {
    async anonymizeParticipant(playerId) {
      return db.$transaction((tx) => anonymizePrismaTenderParticipant(tx, playerId))
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

    async findCommand({ commandId, tenderId }) {
      const commandIds = tenderCommandLookupIds(commandId)
      const commands = await db.tenderCommand.findMany({
        where: {
          commandId: { in: commandIds },
          tenderId,
        },
        select: { commandId: true, fingerprint: true, receipt: true },
      })
      return findStoredCommandByLookupOrder(commands, commandIds)
    },

    async commit(change: TenderCommit): Promise<TenderCommitResult> {
      try {
        return await db.$transaction<TenderCommitResult>(async (tx) => {
          if (change.botActor) {
            const current = await tx.tender.findUnique({
              where: { id: change.tenderId },
              select: { state: true, version: true },
            })
            if (!current || !persistedTenderStateSchema.parse(current.state).players
              .some((player) => player.id === change.actorId && player.bot)) {
              return { kind: 'actor_unavailable' }
            }
            if (current.version !== change.expectedVersion) return { kind: 'version_conflict' }
          } else if (change.actorId && accountLifecycleSecret) {
            const activeActor = await lockActiveAccountLifecycleTransaction(
              tx,
              accountLifecycleSecret,
              change.actorId,
            )
            if (!activeActor) return { kind: 'actor_unavailable' }
          }
          if (change.command && change.commandId) {
            const commandIds = tenderCommandLookupIds(change.commandId)
            const existingCommands = await tx.tenderCommand.findMany({
              where: {
                tenderId: change.tenderId,
                commandId: { in: commandIds },
              },
              select: { commandId: true, fingerprint: true, receipt: true },
            })
            const existingCommand = findStoredCommandByLookupOrder(existingCommands, commandIds)
            if (existingCommand) {
              return { kind: 'command_exists', command: existingCommand }
            }
            const inserted = await tx.tenderCommand.createMany({
              data: {
                tenderId: change.tenderId,
                commandId: tenderStorageCommandId(change.commandId),
                fingerprint: change.command.fingerprint,
                receipt: change.command.receipt as Prisma.InputJsonValue,
              },
              skipDuplicates: true,
            })
            if (inserted.count === 0) {
              const commands = await tx.tenderCommand.findMany({
                where: {
                  tenderId: change.tenderId,
                  commandId: { in: commandIds },
                },
                select: { commandId: true, fingerprint: true, receipt: true },
              })
              const command = findStoredCommandByLookupOrder(commands, commandIds)
              if (!command) throw new Error('Tender command conflict could not be reconciled')
              return { kind: 'command_exists', command }
            }
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
            const storedAuditEvents = change.auditEvents.map((event) => event.commandId
              ? { ...event, commandId: tenderStorageCommandId(event.commandId) }
              : event)
            await tx.tenderAuditEvent.createMany({
              data: storedAuditEvents.map((event, index) => ({
                tenderId: change.tenderId,
                sequence: (latestAuditEvent?.sequence ?? 0) + index + 1,
                actorId: event.actorId,
                commandId: event.commandId,
                kind: event.kind,
                payload: encodeTenderAuditEventPayload(event) as Prisma.InputJsonValue,
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

    async findBotTenders({ afterId, limit }) {
      const records = await db.tender.findMany({
        where: {
          phase: { not: 'complete' },
          ...(afterId ? { id: { gt: afterId } } : {}),
          OR: ['bot-v1', 'bot-v2'].map((strategyVersion) => ({
            state: { path: ['players'], array_contains: [{ bot: { strategyVersion } }] },
          })),
        },
        orderBy: { id: 'asc' },
        take: limit,
        select: { id: true },
      })
      return records.map((record) => record.id)
    },

    async listCompletedForPlayer(playerId) {
      const tenders = await db.tender.findMany({
        where: {
          phase: 'complete',
          state: {
            path: ['players'],
            array_contains: [{ id: playerId }],
          },
        },
        include: { commands: true },
      })
      return tenders.map(toStoredTender)
    },

    async readAuditEvents(tenderId): Promise<StoredTenderAuditEvent[]> {
      const events = await db.tenderAuditEvent.findMany({
        where: { tenderId },
        orderBy: { sequence: 'asc' },
        select: { actorId: true, commandId: true, kind: true, payload: true, sequence: true },
      })
      return events.map(decodeTenderAuditEvent)
    },
  }
}

export class TenderVersionConflict extends Error {}

function earliestDeadline(tender: { abandonmentDueAt: Date | null; dueAt: Date | null }) {
  const deadlines = [tender.dueAt, tender.abandonmentDueAt].filter((value): value is Date => value !== null)
  return new Date(Math.min(...deadlines.map((deadline) => deadline.getTime())))
}
