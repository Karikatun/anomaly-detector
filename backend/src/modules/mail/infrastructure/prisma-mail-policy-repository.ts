import { mailPolicyViewSchema } from '@anomaly-detector/contracts'
import { z } from 'zod'

import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import {
  CONSERVATIVE_MAIL_CANONICALIZATION,
  mailProviderCatalogSchema,
  mailProviderDefinitionSchema,
  type MailProviderCatalog,
  type MailProviderDefinition,
} from '../application/approved-mail-provider-catalog'
import type {
  MailDomainAssessment,
  MailPolicyCommandReceipt,
  MailPolicyCommitResult,
  MailPolicyDecision,
  MailPolicyRepository,
  StoredMailPolicyCommand,
} from '../application/ports'
import { lockMailPolicyTransaction } from './mail-policy-lock'

const providerStateSchema = z.enum(['approved', 'deprecated', 'blocked'])
const storedProviderSchema = mailProviderDefinitionSchema.extend({
  reason: z.string().min(1).max(500).nullable(),
  state: providerStateSchema,
}).strict()
const storedProviderCatalogSchema = z.object({
  providers: z.array(storedProviderSchema).min(1).max(100),
  version: z.number().int().positive(),
}).strict()
const receiptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog_synced'), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('status_changed'), version: z.number().int().positive() }).strict(),
])
const assessmentSchema = z.object({
  catalogVersion: z.number().int().positive(),
  checkedAt: z.date(),
  emailDomain: z.string().min(1).max(253),
  expiresAt: z.date(),
  failureCode: z.string().regex(/^[a-z0-9_]{1,64}$/).nullable(),
  mxFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  outcome: z.enum(['allowed', 'denied', 'retry']),
  providerId: z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/).nullable(),
}).strict().refine((value) => value.expiresAt > value.checkedAt, {
  message: 'Mail-domain assessment must expire after it was checked',
})
const historicalProviderStateSchema = z.object({
  providerId: z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/),
  reason: z.string().min(1).max(500),
  state: z.enum(['deprecated', 'blocked']),
}).strict()

type StoredProvider = z.infer<typeof storedProviderSchema>
type StoredProviderCatalog = z.infer<typeof storedProviderCatalogSchema>

const mailDomainAssessmentCleanupBatchSize = 500
const mailDomainAssessmentCleanupMaxBatches = 20

export async function cleanupExpiredMailDomainAssessments(
  db: DbClient,
  now: Date,
  options: { limit?: number } = {},
) {
  const limit = options.limit ?? mailDomainAssessmentCleanupBatchSize
  if (!Number.isInteger(limit) || limit < 1 || limit > mailDomainAssessmentCleanupBatchSize) {
    throw new TypeError(`Mail-domain assessment cleanup limit must be between 1 and ${mailDomainAssessmentCleanupBatchSize}`)
  }

  if (options.limit !== undefined) {
    const result = await cleanupExpiredMailDomainAssessmentBatch(db, now, limit)
    return { count: result.count }
  }

  let count = 0
  for (let batch = 0; batch < mailDomainAssessmentCleanupMaxBatches; batch += 1) {
    const result = await cleanupExpiredMailDomainAssessmentBatch(db, now, limit)
    count += result.count
    if (result.selectedCount < limit) break
  }
  return { count }
}

async function cleanupExpiredMailDomainAssessmentBatch(
  db: DbClient,
  now: Date,
  limit: number,
) {
  const expired = await db.mailDomainAssessment.findMany({
    orderBy: [
      { expiresAt: 'asc' },
      { emailDomain: 'asc' },
    ],
    select: { emailDomain: true },
    take: limit,
    where: { expiresAt: { lte: now } },
  })
  if (expired.length === 0) return { count: 0, selectedCount: 0 }

  const deleted = await db.mailDomainAssessment.deleteMany({
    where: {
      emailDomain: { in: expired.map(({ emailDomain }) => emailDomain) },
      expiresAt: { lte: now },
    },
  })
  return { count: deleted.count, selectedCount: expired.length }
}

export function createPrismaMailPolicyRepository(db: DbClient): MailPolicyRepository {
  return {
    async findCommand(commandId) {
      const command = await db.mailPolicyCommand.findUnique({ where: { commandId } })
      return command ? toStoredCommand(command) : null
    },

    async syncCatalog(input) {
      return withPolicyLock(db, input.commandId, input.expectedVersion, async (tx, currentPolicy) => {
        const catalog = mailProviderCatalogSchema.parse(input.catalog)
        const currentCatalog = parseStoredCatalog(currentPolicy?.providerCatalog)
        if (currentCatalog) {
          const definitionsEqual = sameCatalogDefinitions(currentCatalog, catalog)
          if (currentCatalog.version > catalog.version
            || (currentCatalog.version === catalog.version && !definitionsEqual)) {
            return { kind: 'catalog_version_conflict' }
          }
          if (currentCatalog.version === catalog.version && definitionsEqual) {
            const receipt: MailPolicyCommandReceipt = {
              kind: 'catalog_synced',
              version: currentPolicy!.version,
            }
            await persistCommandAndAudit(tx, {
              actorId: input.actorId,
              auditKind: 'mail_provider_catalog_sync_unchanged',
              auditPayload: {
                catalogVersion: catalog.version,
                policyVersion: currentPolicy!.version,
              },
              commandId: input.commandId,
              commandKind: 'sync_catalog',
              fingerprint: input.fingerprint,
              receipt,
            })
            return { kind: 'committed', receipt }
          }
        }

        const historicalStates = await readHistoricalProviderStates(
          tx,
          catalog.providers.map(({ providerId }) => providerId),
        )
        const providers = catalog.providers.map((provider) => providerWithPreservedState(
          provider,
          currentCatalog,
          historicalStates.get(provider.providerId) ?? null,
        ))
        const storedCatalog = parseStoredCatalog({ providers, version: catalog.version })!
        const diff = catalogDiff(catalog, currentCatalog)
        const version = input.expectedVersion + 1
        await tx.mailPolicyVersion.create({
          data: {
            catalogVersion: catalog.version,
            providerCatalog: storedCatalog as Prisma.InputJsonValue,
            publishedBy: input.actorId,
            version,
            entries: { create: publicPolicyEntries(storedCatalog) },
          },
        })
        const receipt: MailPolicyCommandReceipt = { kind: 'catalog_synced', version }
        await persistCommandAndAudit(tx, {
          actorId: input.actorId,
          auditKind: 'mail_provider_catalog_synced',
          auditPayload: {
            ...diff,
            catalogVersion: catalog.version,
            previousVersion: input.expectedVersion,
            version,
          },
          commandId: input.commandId,
          commandKind: 'sync_catalog',
          fingerprint: input.fingerprint,
          receipt,
        })
        return { kind: 'committed', receipt }
      })
    },

    async changeStatus(input) {
      return withPolicyLock(db, input.commandId, input.expectedVersion, async (tx, currentPolicy) => {
        const currentCatalog = parseStoredCatalog(currentPolicy?.providerCatalog)
        if (!currentCatalog || !currentCatalog.providers.some(({ providerId }) => providerId === input.providerId)) {
          return { kind: 'provider_not_found' }
        }
        const providers = currentCatalog.providers.map((provider) => provider.providerId === input.providerId
          ? { ...provider, reason: input.reason, state: input.state }
          : provider)
        const storedCatalog = parseStoredCatalog({
          providers,
          version: currentCatalog.version,
        })!
        const version = input.expectedVersion + 1
        await tx.mailPolicyVersion.create({
          data: {
            catalogVersion: storedCatalog.version,
            providerCatalog: storedCatalog as Prisma.InputJsonValue,
            publishedBy: input.actorId,
            version,
            entries: { create: publicPolicyEntries(storedCatalog) },
          },
        })
        const receipt: MailPolicyCommandReceipt = { kind: 'status_changed', version }
        await persistCommandAndAudit(tx, {
          actorId: input.actorId,
          auditKind: 'mail_policy_provider_status_changed',
          auditPayload: {
            previousVersion: input.expectedVersion,
            providerId: input.providerId,
            reason: input.reason,
            state: input.state,
            version,
          },
          commandId: input.commandId,
          commandKind: 'change_status',
          fingerprint: input.fingerprint,
          receipt,
        })
        return { kind: 'committed', receipt }
      })
    },

    async evaluate(emailDomain, now) {
      const [policy, assessment] = await Promise.all([
        db.mailPolicyVersion.findFirst({
          orderBy: { version: 'desc' },
          include: { entries: { where: { emailDomain } } },
        }),
        db.mailDomainAssessment.findUnique({ where: { emailDomain } }),
      ])
      return evaluateMailPolicySnapshot({ assessment, emailDomain, now, policy })
    },

    async storeAssessment(input: MailDomainAssessment) {
      const assessment = assessmentSchema.parse(input)
      await db.$executeRaw`
        INSERT INTO "mail_domain_assessments" (
          "email_domain",
          "catalog_version",
          "provider_id",
          "outcome",
          "failure_code",
          "mx_fingerprint",
          "checked_at",
          "expires_at"
        ) VALUES (
          ${assessment.emailDomain},
          ${assessment.catalogVersion},
          ${assessment.providerId},
          ${assessment.outcome},
          ${assessment.failureCode},
          ${assessment.mxFingerprint},
          ${assessment.checkedAt},
          ${assessment.expiresAt}
        )
        ON CONFLICT ("email_domain") DO UPDATE SET
          "catalog_version" = EXCLUDED."catalog_version",
          "provider_id" = EXCLUDED."provider_id",
          "outcome" = EXCLUDED."outcome",
          "failure_code" = EXCLUDED."failure_code",
          "mx_fingerprint" = EXCLUDED."mx_fingerprint",
          "checked_at" = EXCLUDED."checked_at",
          "expires_at" = EXCLUDED."expires_at"
        WHERE "mail_domain_assessments"."checked_at" <= EXCLUDED."checked_at"
      `
    },

    async readView(now, availableCatalog) {
      const catalog = mailProviderCatalogSchema.parse(availableCatalog)
      const policy = await db.mailPolicyVersion.findFirst({
        orderBy: { version: 'desc' },
      })
      const storedCatalog = policy?.providerCatalog
        ? parseStoredCatalog(policy.providerCatalog)
        : null
      return mailPolicyViewSchema.parse({
        availableCatalog: {
          diff: catalogDiff(catalog, storedCatalog),
          providers: catalog.providers,
          version: catalog.version,
        },
        currentVersion: policy?.version ?? 0,
        generatedAt: now.toISOString(),
        publishedPolicy: policy && storedCatalog
          ? {
              catalogVersion: storedCatalog.version,
              providers: storedCatalog.providers,
              publishedAt: policy.publishedAt.toISOString(),
              version: policy.version,
            }
          : null,
      })
    },
  }
}

export function evaluateMailPolicySnapshot(input: {
  assessment: null | {
    catalogVersion: number
    expiresAt: Date
    outcome: string
    providerId: string | null
  }
  emailDomain: string
  now: Date
  policy: null | {
    entries: Array<{
      ignoreDots: boolean
      localPartCaseInsensitive: boolean
      providerId: string | null
      state: string
      stripPlusTag: boolean
    }>
    providerCatalog: Prisma.JsonValue | null
    version: number
  }
}): MailPolicyDecision {
  const { assessment, emailDomain, now, policy } = input
  if (!policy) return unlistedDecision(0, null, false)

  const entry = policy.entries[0]
  const storedCatalog = safeParseStoredCatalog(policy.providerCatalog)
  if (!storedCatalog) {
    return unlistedDecision(policy.version, null, false)
  }
  if (entry) {
    const state = providerStateSchema.parse(entry.state)
    const provider = entry.providerId
      ? storedCatalog?.providers.find(({ providerId }) => providerId === entry.providerId)
      : null
    if (entry.providerId && !provider) {
      return unlistedDecision(policy.version, storedCatalog?.version ?? null, false)
    }
    const effectiveState = provider?.state ?? state
    return policyDecision({
      canonicalization: {
        ignoreDots: entry.ignoreDots,
        localPartCaseInsensitive: entry.localPartCaseInsensitive,
        stripPlusTag: entry.stripPlusTag,
      },
      catalogVersion: storedCatalog?.version ?? null,
      providerId: provider?.providerId ?? null,
      source: 'public_domain',
      state: effectiveState,
      version: policy.version,
    })
  }

  if (!storedCatalog || !supportsCustomDomain(storedCatalog, emailDomain)) {
    return unlistedDecision(policy.version, storedCatalog?.version ?? null, false)
  }
  if (!assessment
    || assessment.catalogVersion !== storedCatalog.version
    || assessment.expiresAt <= now) {
    return unlistedDecision(policy.version, storedCatalog.version, true)
  }
  if (assessment.outcome !== 'allowed' || !assessment.providerId) {
    return unlistedDecision(policy.version, storedCatalog.version, false)
  }
  const provider = storedCatalog.providers.find(({ providerId }) => providerId === assessment.providerId)
  if (!provider?.customDomain || !providerAllowsDomain(provider, emailDomain)) {
    return unlistedDecision(policy.version, storedCatalog.version, true)
  }
  return policyDecision({
    canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
    catalogVersion: storedCatalog.version,
    providerId: provider.providerId,
    source: 'mx',
    state: provider.state,
    version: policy.version,
  })
}

export function evaluateMailProviderSnapshot(input: {
  policy: null | { providerCatalog: Prisma.JsonValue | null; version: number }
  providerId: string
}) {
  if (!input.policy) return null
  const catalog = safeParseStoredCatalog(input.policy.providerCatalog)
  const provider = catalog?.providers.find(({ providerId }) => providerId === input.providerId)
  if (!catalog || !provider) return null
  return {
    allowsRecoveryDelivery: provider.state !== 'blocked',
    catalogVersion: catalog.version,
    state: provider.state,
    version: input.policy.version,
  }
}

async function withPolicyLock(
  db: DbClient,
  commandId: string,
  expectedVersion: number,
  operation: (
    tx: Prisma.TransactionClient,
    currentPolicy: Awaited<ReturnType<typeof readCurrentPolicy>>,
  ) => Promise<MailPolicyCommitResult>,
) {
  return db.$transaction<MailPolicyCommitResult>(async (tx) => {
    await lockMailPolicyTransaction(tx)
    const existing = await tx.mailPolicyCommand.findUnique({ where: { commandId } })
    if (existing) return { kind: 'command_exists', ...toStoredCommand(existing) }
    const currentPolicy = await readCurrentPolicy(tx)
    if ((currentPolicy?.version ?? 0) !== expectedVersion) return { kind: 'version_conflict' }
    return operation(tx, currentPolicy)
  })
}

function readCurrentPolicy(tx: Prisma.TransactionClient) {
  return tx.mailPolicyVersion.findFirst({
    orderBy: { version: 'desc' },
    include: { entries: { orderBy: { emailDomain: 'asc' } } },
  })
}

function parseStoredCatalog(value: unknown): StoredProviderCatalog | null {
  if (value === null || value === undefined) return null
  const stored = storedProviderCatalogSchema.parse(value)
  mailProviderCatalogSchema.parse({
    providers: stored.providers.map(providerDefinition),
    version: stored.version,
  })
  return stored
}

function safeParseStoredCatalog(value: unknown) {
  try {
    return parseStoredCatalog(value)
  } catch {
    return null
  }
}

function providerWithPreservedState(
  provider: MailProviderDefinition,
  currentCatalog: StoredProviderCatalog | null,
  historicalState: z.infer<typeof historicalProviderStateSchema> | null,
): StoredProvider {
  const current = currentCatalog?.providers.find(({ providerId }) => providerId === provider.providerId)
  if (current) return { ...provider, reason: current.reason, state: current.state }
  if (historicalState) {
    return { ...provider, reason: historicalState.reason, state: historicalState.state }
  }
  return {
    ...provider,
    reason: null,
    state: 'approved',
  }
}

async function readHistoricalProviderStates(
  tx: Prisma.TransactionClient,
  providerIds: readonly string[],
) {
  if (providerIds.length === 0) return new Map<string, z.infer<typeof historicalProviderStateSchema>>()
  const rows = await tx.$queryRaw<Array<{ providerId: string; reason: string; state: string }>>(
    Prisma.sql`
      SELECT DISTINCT ON (payload->>'providerId')
        payload->>'providerId' AS "providerId",
        payload->>'reason' AS "reason",
        payload->>'state' AS "state"
      FROM "mail_policy_audit_events"
      WHERE kind = 'mail_policy_provider_status_changed'
        AND payload->>'providerId' IN (${Prisma.join(providerIds)})
      ORDER BY
        payload->>'providerId',
        (payload->>'version')::integer DESC,
        occurred_at DESC
    `,
  )
  return new Map(rows.map((row) => {
    const state = historicalProviderStateSchema.parse(row)
    return [state.providerId, state]
  }))
}

function publicPolicyEntries(catalog: StoredProviderCatalog) {
  return catalog.providers.flatMap((provider) => provider.publicDomains.map((entry) => ({
    emailDomain: entry.emailDomain,
    ignoreDots: entry.canonicalization.ignoreDots,
    localPartCaseInsensitive: entry.canonicalization.localPartCaseInsensitive,
    providerId: provider.providerId,
    reason: provider.reason,
    state: provider.state,
    stripPlusTag: entry.canonicalization.stripPlusTag,
  })))
}

function providerDefinition(provider: StoredProvider): MailProviderDefinition {
  return {
    customDomain: provider.customDomain,
    displayName: provider.displayName,
    evidenceUrl: provider.evidenceUrl,
    providerId: provider.providerId,
    publicDomains: provider.publicDomains,
  }
}

function catalogDiff(available: MailProviderCatalog, current: StoredProviderCatalog | null) {
  const availableById = new Map(available.providers.map((provider) => [provider.providerId, provider]))
  const currentById = new Map((current?.providers ?? []).map((provider) => [provider.providerId, provider]))
  const addedProviderIds = available.providers
    .filter(({ providerId }) => !currentById.has(providerId))
    .map(({ providerId }) => providerId)
  const changedProviderIds = available.providers
    .filter((provider) => {
      const stored = currentById.get(provider.providerId)
      return stored && JSON.stringify(provider) !== JSON.stringify(providerDefinition(stored))
    })
    .map(({ providerId }) => providerId)
  const removedProviderIds = (current?.providers ?? [])
    .filter(({ providerId }) => !availableById.has(providerId))
    .map(({ providerId }) => providerId)
  return { addedProviderIds, changedProviderIds, removedProviderIds }
}

function sameCatalogDefinitions(current: StoredProviderCatalog, available: MailProviderCatalog) {
  const diff = catalogDiff(available, current)
  return diff.addedProviderIds.length === 0
    && diff.changedProviderIds.length === 0
    && diff.removedProviderIds.length === 0
}

function providerAllowsDomain(provider: StoredProvider, emailDomain: string) {
  return provider.customDomain?.allowedZones.some((zone) => emailDomain.endsWith(`.${zone}`)) ?? false
}

function supportsCustomDomain(catalog: StoredProviderCatalog, emailDomain: string) {
  return catalog.providers.some((provider) => providerAllowsDomain(provider, emailDomain))
}

function policyDecision(input: {
  canonicalization: MailPolicyDecision['canonicalization']
  catalogVersion: number | null
  providerId: string | null
  source: 'mx' | 'public_domain'
  state: 'approved' | 'deprecated' | 'blocked'
  version: number
}): MailPolicyDecision {
  return {
    acceptsNewAddress: input.state === 'approved',
    allowsRecoveryDelivery: input.state !== 'blocked',
    canonicalization: input.canonicalization,
    catalogVersion: input.catalogVersion,
    providerId: input.providerId,
    requiresMxAssessment: false,
    source: input.source,
    state: input.state,
    version: input.version,
  }
}

function unlistedDecision(
  version: number,
  catalogVersion: number | null,
  requiresMxAssessment: boolean,
): MailPolicyDecision {
  return {
    acceptsNewAddress: false,
    allowsRecoveryDelivery: false,
    canonicalization: null,
    catalogVersion,
    providerId: null,
    requiresMxAssessment,
    state: 'unlisted',
    version,
  }
}

async function persistCommandAndAudit(tx: Prisma.TransactionClient, input: {
  actorId: string
  auditKind: string
  auditPayload: Prisma.InputJsonValue
  commandId: string
  commandKind: string
  fingerprint: string
  receipt: MailPolicyCommandReceipt
}) {
  await tx.mailPolicyCommand.create({
    data: {
      actorId: input.actorId,
      commandId: input.commandId,
      fingerprint: input.fingerprint,
      kind: input.commandKind,
      receipt: input.receipt as Prisma.InputJsonValue,
    },
  })
  await tx.mailPolicyAuditEvent.create({
    data: {
      actorId: input.actorId,
      commandId: input.commandId,
      kind: input.auditKind,
      payload: input.auditPayload,
    },
  })
}

function toStoredCommand(record: { fingerprint: string; receipt: Prisma.JsonValue }): StoredMailPolicyCommand {
  return {
    fingerprint: record.fingerprint.trim(),
    receipt: receiptSchema.parse(record.receipt),
  }
}
