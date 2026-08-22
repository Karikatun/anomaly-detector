import { mailPolicyViewSchema } from '@anomaly-detector/contracts'
import { z } from 'zod'

import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import type {
  MailPolicyCommandReceipt,
  MailPolicyCommitResult,
  MailPolicyRepository,
  StoredMailPolicyCommand,
} from '../application/ports'
import { lockMailPolicyTransaction } from './mail-policy-lock'

const SUSPICIOUS_REMOVAL_RATIO = 0.3
const MIN_SUSPICIOUS_REMOVALS = 5
const MAX_POLICY_ENTRIES = 100

const receiptSchema = z.discriminatedUnion('kind', [
  z.object({ failureCode: z.string().min(1).max(64), kind: z.literal('import_failed') }).strict(),
  z.object({ failureCode: z.string().min(1).max(64), kind: z.literal('import_rejected') }).strict(),
  z.object({ importId: z.string().uuid(), kind: z.literal('import_succeeded') }).strict(),
  z.object({ kind: z.literal('policy_published'), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('status_changed'), version: z.number().int().positive() }).strict(),
])

const domainListSchema = z.array(z.string().min(1).max(253)).max(5_000)

export function createPrismaMailPolicyRepository(db: DbClient): MailPolicyRepository {
  return {
    async findCommand(commandId) {
      const command = await db.mailPolicyCommand.findUnique({ where: { commandId } })
      return command ? toStoredCommand(command) : null
    },

    async commitImport(input) {
      return withPolicyLock(db, input.commandId, input.expectedVersion, async (tx) => {
        const previous = await tx.mailRegistryImport.findFirst({
          where: { outcome: 'succeeded' },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          include: { candidates: true },
        })
        const previousKeys = new Set(previous?.candidates.map(candidateKey) ?? [])
        const currentKeys = new Set(input.candidates.map(candidateKey))
        const addedCandidates = input.candidates.filter((candidate) => !previousKeys.has(candidateKey(candidate)))
        const removedCandidates = (previous?.candidates ?? []).filter((candidate) => !currentKeys.has(candidateKey(candidate)))
        const addedDomains = uniqueDomains(addedCandidates)
        const removedDomains = uniqueDomains(removedCandidates)
        const unchangedCount = input.candidates.length - addedCandidates.length
        const suspicious = isSuspiciousRemoval(previousKeys.size, removedCandidates.length)
        const imported = await tx.mailRegistryImport.create({
          data: {
            actorId: input.actorId,
            addedDomains,
            checksum: input.checksum,
            failureCode: suspicious ? 'suspicious_mass_removal' : null,
            outcome: suspicious ? 'rejected' : 'succeeded',
            removedDomains,
            sourceDate: input.sourceDate,
            sourceUrl: input.sourceUrl,
            unchangedCount,
            ...(suspicious ? {} : {
              candidates: {
                create: input.candidates.map((candidate) => ({
                  evidence: candidate.evidence,
                  registryEntryId: candidate.registryEntryId,
                  serviceDomain: candidate.serviceDomain,
                })),
              },
            }),
          },
        })
        const receipt: MailPolicyCommandReceipt = suspicious
          ? { failureCode: 'suspicious_mass_removal', kind: 'import_rejected' }
          : { importId: imported.id, kind: 'import_succeeded' }
        await persistCommandAndAudit(tx, {
          actorId: input.actorId,
          auditKind: suspicious ? 'mail_registry_import_rejected' : 'mail_registry_import_succeeded',
          auditPayload: {
            addedCount: addedCandidates.length,
            checksum: input.checksum,
            removedCount: removedCandidates.length,
            sourceDate: input.sourceDate,
            sourceUrl: input.sourceUrl,
            unchangedCount,
          },
          commandId: input.commandId,
          commandKind: 'import_candidates',
          fingerprint: input.fingerprint,
          receipt,
        })
        return { kind: 'committed', receipt }
      })
    },

    async commitImportFailure(input) {
      return withPolicyLock(db, input.commandId, input.expectedVersion, async (tx) => {
        await tx.mailRegistryImport.create({
          data: {
            actorId: input.actorId,
            addedDomains: [],
            checksum: null,
            failureCode: input.failureCode,
            outcome: 'failed',
            removedDomains: [],
            sourceDate: null,
            sourceUrl: null,
            unchangedCount: 0,
          },
        })
        const receipt: MailPolicyCommandReceipt = {
          failureCode: input.failureCode,
          kind: 'import_failed',
        }
        await persistCommandAndAudit(tx, {
          actorId: input.actorId,
          auditKind: 'mail_registry_import_failed',
          auditPayload: { failureCode: input.failureCode },
          commandId: input.commandId,
          commandKind: 'import_candidates',
          fingerprint: input.fingerprint,
          receipt,
        })
        return { kind: 'committed', receipt }
      })
    },

    async publish(input) {
      return withPolicyLock(db, input.commandId, input.expectedVersion, async (tx, currentPolicy) => {
        const latestImport = await tx.mailRegistryImport.findFirst({
          where: { outcome: 'succeeded' },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
        if (!latestImport) return { kind: 'candidate_not_found' }
        const selectedCandidates = await tx.mailRegistryCandidate.findMany({
          where: {
            id: { in: input.additions.map((addition) => addition.sourceCandidateId) },
            importId: latestImport.id,
          },
          select: { id: true },
        })
        if (selectedCandidates.length !== new Set(input.additions.map((addition) => addition.sourceCandidateId)).size) {
          return { kind: 'candidate_not_found' }
        }
        const existingEntries = currentPolicy?.entries ?? []
        if (existingEntries.length + input.additions.length > MAX_POLICY_ENTRIES) {
          return { kind: 'policy_limit_exceeded' }
        }
        const existingDomains = new Set(existingEntries.map((entry) => entry.emailDomain))
        if (input.additions.some((addition) => existingDomains.has(addition.emailDomain))) {
          return { kind: 'domain_already_exists' }
        }
        const version = input.expectedVersion + 1
        await tx.mailPolicyVersion.create({
          data: {
            publishedBy: input.actorId,
            version,
            entries: {
              create: [
                ...existingEntries.map(copyPolicyEntry),
                ...input.additions.map((addition) => ({
                  emailDomain: addition.emailDomain,
                  ignoreDots: addition.canonicalization.ignoreDots,
                  localPartCaseInsensitive: addition.canonicalization.localPartCaseInsensitive,
                  reason: null,
                  sourceCandidateId: addition.sourceCandidateId,
                  state: 'approved',
                  stripPlusTag: addition.canonicalization.stripPlusTag,
                })),
              ],
            },
          },
        })
        const receipt: MailPolicyCommandReceipt = { kind: 'policy_published', version }
        await persistCommandAndAudit(tx, {
          actorId: input.actorId,
          auditKind: 'mail_policy_published',
          auditPayload: {
            additions: input.additions,
            previousVersion: input.expectedVersion,
            version,
          },
          commandId: input.commandId,
          commandKind: 'publish_policy',
          fingerprint: input.fingerprint,
          receipt,
        })
        return { kind: 'committed', receipt }
      })
    },

    async changeStatus(input) {
      return withPolicyLock(db, input.commandId, input.expectedVersion, async (tx, currentPolicy) => {
        const existingEntries = currentPolicy?.entries ?? []
        if (!existingEntries.some((entry) => entry.emailDomain === input.emailDomain)) {
          return { kind: 'domain_not_found' }
        }
        const version = input.expectedVersion + 1
        await tx.mailPolicyVersion.create({
          data: {
            publishedBy: input.actorId,
            version,
            entries: {
              create: existingEntries.map((entry) => entry.emailDomain === input.emailDomain
                ? {
                    ...copyPolicyEntry(entry),
                    reason: input.reason,
                    state: input.state,
                  }
                : copyPolicyEntry(entry)),
            },
          },
        })
        const receipt: MailPolicyCommandReceipt = { kind: 'status_changed', version }
        await persistCommandAndAudit(tx, {
          actorId: input.actorId,
          auditKind: 'mail_policy_status_changed',
          auditPayload: {
            emailDomain: input.emailDomain,
            previousVersion: input.expectedVersion,
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

    async evaluate(emailDomain) {
      const policy = await db.mailPolicyVersion.findFirst({
        orderBy: { version: 'desc' },
        include: { entries: { where: { emailDomain } } },
      })
      const entry = policy?.entries[0]
      if (!policy || !entry) {
        return {
          acceptsNewAddress: false,
          allowsRecoveryDelivery: false,
          canonicalization: null,
          state: 'unlisted',
          version: policy?.version ?? 0,
        }
      }
      const state = z.enum(['approved', 'deprecated', 'blocked']).parse(entry.state)
      return {
        acceptsNewAddress: state === 'approved',
        allowsRecoveryDelivery: state !== 'blocked',
        canonicalization: {
          ignoreDots: entry.ignoreDots,
          localPartCaseInsensitive: entry.localPartCaseInsensitive,
          stripPlusTag: entry.stripPlusTag,
        },
        state,
        version: policy.version,
      }
    },

    async readView(now) {
      const [latestAttempt, lastSuccessfulImport, publishedPolicy] = await Promise.all([
        db.mailRegistryImport.findFirst({
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        }),
        db.mailRegistryImport.findFirst({
          where: { outcome: 'succeeded' },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          include: { candidates: { orderBy: [{ serviceDomain: 'asc' }, { registryEntryId: 'asc' }] } },
        }),
        db.mailPolicyVersion.findFirst({
          orderBy: { version: 'desc' },
          include: { entries: { orderBy: { emailDomain: 'asc' } } },
        }),
      ])
      return mailPolicyViewSchema.parse({
        currentVersion: publishedPolicy?.version ?? 0,
        generatedAt: now.toISOString(),
        latestAttempt: latestAttempt
          ? {
              checksum: latestAttempt.checksum?.trim() ?? null,
              failureCode: latestAttempt.failureCode,
              finishedAt: latestAttempt.finishedAt.toISOString(),
              id: latestAttempt.id,
              outcome: latestAttempt.outcome,
              sourceDate: latestAttempt.sourceDate,
              sourceUrl: latestAttempt.sourceUrl,
            }
          : null,
        lastSuccessfulImport: lastSuccessfulImport
          ? {
              candidates: lastSuccessfulImport.candidates.map((candidate) => ({
                evidence: candidate.evidence,
                id: candidate.id,
                registryEntryId: candidate.registryEntryId,
                serviceDomain: candidate.serviceDomain,
              })),
              diff: {
                added: domainListSchema.parse(lastSuccessfulImport.addedDomains),
                removed: domainListSchema.parse(lastSuccessfulImport.removedDomains),
                unchangedCount: lastSuccessfulImport.unchangedCount,
              },
              importId: lastSuccessfulImport.id,
            }
          : null,
        publishedPolicy: publishedPolicy
          ? {
              entries: publishedPolicy.entries.map((entry) => ({
                canonicalization: {
                  ignoreDots: entry.ignoreDots,
                  localPartCaseInsensitive: entry.localPartCaseInsensitive,
                  stripPlusTag: entry.stripPlusTag,
                },
                emailDomain: entry.emailDomain,
                reason: entry.reason,
                sourceCandidateId: entry.sourceCandidateId,
                state: entry.state,
              })),
              publishedAt: publishedPolicy.publishedAt.toISOString(),
              version: publishedPolicy.version,
            }
          : null,
      })
    },
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

function copyPolicyEntry(entry: {
  emailDomain: string
  ignoreDots: boolean
  localPartCaseInsensitive: boolean
  reason: string | null
  sourceCandidateId: string
  state: string
  stripPlusTag: boolean
}) {
  return {
    emailDomain: entry.emailDomain,
    ignoreDots: entry.ignoreDots,
    localPartCaseInsensitive: entry.localPartCaseInsensitive,
    reason: entry.reason,
    sourceCandidateId: entry.sourceCandidateId,
    state: entry.state,
    stripPlusTag: entry.stripPlusTag,
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

function candidateKey(candidate: { registryEntryId: string; serviceDomain: string }) {
  return `${candidate.registryEntryId}\u0000${candidate.serviceDomain}`
}

function uniqueDomains(candidates: Array<{ serviceDomain: string }>) {
  return [...new Set(candidates.map((candidate) => candidate.serviceDomain))].sort()
}

function isSuspiciousRemoval(previousCount: number, removedCount: number) {
  if (previousCount === 0 || removedCount === 0) return false
  const threshold = previousCount < MIN_SUSPICIOUS_REMOVALS
    ? Math.ceil(previousCount / 2)
    : Math.max(MIN_SUSPICIOUS_REMOVALS, Math.ceil(previousCount * SUSPICIOUS_REMOVAL_RATIO))
  return removedCount >= threshold
}
