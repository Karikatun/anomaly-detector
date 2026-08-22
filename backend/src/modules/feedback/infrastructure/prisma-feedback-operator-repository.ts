import {
  feedbackOperatorCommandResponseSchema,
  feedbackQueueResponseSchema,
} from '@anomaly-detector/contracts'
import type {
  FeedbackOperatorCommandResponse,
  FeedbackQueueQuery,
} from '@anomaly-detector/contracts'

import type { DbClient } from '../../../db'
import type {
  FeedbackReport as PrismaFeedbackReport,
  Prisma,
} from '../../../generated/prisma/client'
import type {
  FeedbackOperatorCommitResult,
  FeedbackOperatorRepository,
  StoredFeedbackOperatorCommand,
} from '../application/ports'

type BaseCommandInput = {
  actorId: string
  commandId: string
  expectedVersion: number
  fingerprint: string
  now: Date
  reportId: string
}

type MutationDecision =
  | { kind: 'contact_absent' | 'transition_conflict' }
  | {
      auditKind: string
      auditPayload: Prisma.InputJsonValue
      commandKind: string
      data: Prisma.FeedbackReportUpdateInput
      kind: 'update'
    }

export function createPrismaFeedbackOperatorRepository(
  db: DbClient,
): FeedbackOperatorRepository {
  return {
    async findCommand(commandId) {
      const command = await db.feedbackOperatorCommand.findUnique({ where: { commandId } })
      return command ? toStoredCommand(command) : null
    },

    async read(query) {
      return readQueue(db, query)
    },

    async take(input) {
      return commitCommand(db, input, (report) => report.status !== 'new'
        ? { kind: 'transition_conflict' }
        : {
            auditKind: 'feedback_taken_in_review',
            auditPayload: { fromStatus: 'new', toStatus: 'in_review' },
            commandKind: 'take_in_review',
            data: { status: 'in_review', takenAt: input.now },
            kind: 'update',
          })
    },

    async resolve(input) {
      return commitCommand(db, input, (report) => report.status !== 'in_review'
        ? { kind: 'transition_conflict' }
        : {
            auditKind: 'feedback_resolved',
            auditPayload: { fromStatus: 'in_review', toStatus: 'resolved' },
            commandKind: 'resolve',
            data: { resolvedAt: input.now, status: 'resolved' },
            kind: 'update',
          })
    },

    async reject(input) {
      return commitCommand(db, input, (report) =>
        !['new', 'in_review'].includes(report.status)
          ? { kind: 'transition_conflict' }
          : {
              auditKind: 'feedback_rejected',
              auditPayload: {
                fromStatus: report.status,
                reasonRecorded: true,
                toStatus: 'rejected',
              },
              commandKind: 'reject',
              data: {
                rejectedAt: input.now,
                rejectionReason: input.reason,
                status: 'rejected',
              },
              kind: 'update',
            })
    },

    async recordGithubIssue(input) {
      return commitCommand(db, input, (report) =>
        report.status !== 'in_review' || report.githubIssueNumber !== null
          ? { kind: 'transition_conflict' }
          : {
              auditKind: 'feedback_github_issue_recorded',
              auditPayload: { githubIssueNumber: input.githubIssueNumber },
              commandKind: 'record_github_issue',
              data: {
                githubIssueNumber: input.githubIssueNumber,
                transferredAt: input.now,
              },
              kind: 'update',
            })
    },

    async deleteContact(input) {
      return commitCommand(db, input, (report) => report.replyEmail === null
        ? { kind: 'contact_absent' }
        : {
            auditKind: 'feedback_contact_deleted',
            auditPayload: { hadContact: true },
            commandKind: 'delete_contact',
            data: { contactDeletedAt: input.now, replyEmail: null },
            kind: 'update',
          })
    },
  }
}

async function readQueue(db: DbClient, query: FeedbackQueueQuery) {
  const where: Prisma.FeedbackReportWhereInput = {
    ...(query.category ? { category: query.category } : {}),
    ...(query.status ? { status: query.status } : {}),
  }
  const [totalItems, records] = await Promise.all([
    db.feedbackReport.count({ where }),
    db.feedbackReport.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])
  return feedbackQueueResponseSchema.parse({
    items: records.map(toReportView),
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
  })
}

async function commitCommand(
  db: DbClient,
  input: BaseCommandInput,
  decide: (report: PrismaFeedbackReport) => MutationDecision,
): Promise<FeedbackOperatorCommitResult> {
  return db.$transaction(async (tx) => {
    const lockKeys = [
      `feedback-command:${input.commandId}`,
      `feedback-report:${input.reportId}`,
    ].sort()
    for (const lockKey of lockKeys) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"`
    }

    const existing = await tx.feedbackOperatorCommand.findUnique({
      where: { commandId: input.commandId },
    })
    if (existing) return { kind: 'command_exists', ...toStoredCommand(existing) }

    const report = await tx.feedbackReport.findUnique({ where: { id: input.reportId } })
    if (!report) return { kind: 'report_not_found' }
    if (report.version !== input.expectedVersion) return { kind: 'version_conflict' }

    const decision = decide(report)
    if (decision.kind !== 'update') return decision

    const receipt = feedbackOperatorCommandResponseSchema.parse({
      commandId: input.commandId,
      reportId: input.reportId,
      version: input.expectedVersion + 1,
    })
    await tx.feedbackReport.update({
      where: { id: input.reportId },
      data: { ...decision.data, version: receipt.version },
    })
    await persistCommandAndAudit(tx, input, decision, receipt)
    return { kind: 'committed', receipt }
  })
}

async function persistCommandAndAudit(
  tx: Prisma.TransactionClient,
  input: BaseCommandInput,
  decision: Extract<MutationDecision, { kind: 'update' }>,
  receipt: FeedbackOperatorCommandResponse,
) {
  await tx.feedbackOperatorCommand.create({
    data: {
      actorId: input.actorId,
      commandId: input.commandId,
      fingerprint: input.fingerprint,
      kind: decision.commandKind,
      receipt: receipt as Prisma.InputJsonValue,
      reportId: input.reportId,
    },
  })
  await tx.feedbackAuditEvent.create({
    data: {
      actorId: input.actorId,
      commandId: input.commandId,
      fromVersion: input.expectedVersion,
      kind: decision.auditKind,
      payload: decision.auditPayload,
      reportId: input.reportId,
      toVersion: receipt.version,
    },
  })
}

function toStoredCommand(record: { fingerprint: string; receipt: Prisma.JsonValue }): StoredFeedbackOperatorCommand {
  return {
    fingerprint: record.fingerprint.trim(),
    receipt: feedbackOperatorCommandResponseSchema.parse(record.receipt),
  }
}

function toReportView(record: PrismaFeedbackReport) {
  const common = {
    contactDeletedAt: record.contactDeletedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    githubIssueNumber: record.githubIssueNumber,
    id: record.id,
    linkedAccountId: record.linkedUserId,
    publicNumber: record.publicNumber,
    rejectedAt: record.rejectedAt?.toISOString() ?? null,
    rejectionReason: record.rejectionReason,
    replyEmail: record.replyEmail,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    status: record.status,
    takenAt: record.takenAt?.toISOString() ?? null,
    technicalContext: {
      browserClass: record.browserClass,
      buildSha: record.buildSha?.trim() ?? null,
      deviceClass: record.deviceClass,
      errorId: record.errorId,
      routeTemplate: record.routeTemplate,
    },
    transferredAt: record.transferredAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
    version: record.version,
  }
  if (record.category === 'error') {
    return {
      ...common,
      canContinue: record.errorCanContinue,
      category: record.category,
      expectedResult: record.errorExpectedResult,
      reproductionSteps: record.errorReproductionSteps,
      whatHappened: record.errorWhatHappened,
    }
  }
  return {
    ...common,
    category: record.category,
    desiredChange: record.suggestionDesiredChange,
    problemSolved: record.suggestionProblemSolved,
  }
}
