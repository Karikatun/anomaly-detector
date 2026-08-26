import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { FeedbackOperatorService } from '../application/feedback-operator-service'
import { FeedbackFailure } from '../domain/errors'
import { createPrismaFeedbackOperatorRepository } from './prisma-feedback-operator-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const now = new Date('2026-08-23T12:00:00.000Z')
const operator = {
  id: '019f8099-7e26-7760-ad08-66d1d66b2718',
}

maybeDescribe('Prisma feedback operator queue', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const service = new FeedbackOperatorService({
    clock: { now: () => now },
    fingerprintKey: 'test-feedback-operator-fingerprint-key',
    repository: createPrismaFeedbackOperatorRepository(prisma),
  })

  beforeEach(async () => {
    await prisma.feedbackReport.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('lists immutable source and applies the explicit review workflow with safe audit', async () => {
    const report = await createReport()
    const queue = await service.read({ page: 1, pageSize: 20 })
    expect(queue.items[0]).toMatchObject({
      category: 'error',
      publicNumber: report.publicNumber,
      replyEmail: 'reply@example.com',
      status: 'new',
      version: 1,
      whatHappened: 'Карточка не открылась.',
    })
    expect(JSON.stringify(queue)).not.toMatch(/keyHash|ipAddress|cookie|token/i)

    const sourceBefore = await sourceSnapshot(report.id)
    await service.take({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      expectedVersion: 1,
    }, operator, report.id)
    await service.recordGithubIssue({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2721',
      expectedVersion: 2,
      githubIssueNumber: 410,
    }, operator, report.id)
    const resolved = await service.resolve({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2722',
      expectedVersion: 3,
    }, operator, report.id)

    expect(resolved).toEqual({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2722',
      reportId: report.id,
      version: 4,
    })
    expect(await sourceSnapshot(report.id)).toEqual(sourceBefore)
    const audits = await prisma.feedbackAuditEvent.findMany({
      where: { reportId: report.id },
      orderBy: { fromVersion: 'asc' },
    })
    expect(audits.map((event) => event.kind)).toEqual([
      'feedback_taken_in_review',
      'feedback_github_issue_recorded',
      'feedback_resolved',
    ])
    expect(JSON.stringify(audits)).not.toContain('reply@example.com')
    expect(JSON.stringify(audits)).not.toContain('Карточка не открылась')
  })

  test('makes command replay idempotent and rejects changed payload or stale parallel writers', async () => {
    const report = await createReport()
    const command = {
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2730',
      expectedVersion: 1,
    }

    const outcomes = await Promise.allSettled([
      service.take(command, operator, report.id),
      service.take({ ...command, commandId: '019f8099-7e26-7760-ad08-66d1d66b2731' }, operator, report.id),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(await prisma.feedbackAuditEvent.count({ where: { reportId: report.id } })).toBe(1)

    const winningReceipt = outcomes.find((outcome) => outcome.status === 'fulfilled')
    if (!winningReceipt || winningReceipt.status !== 'fulfilled') throw new Error('missing winner')
    const winningCommand = {
      commandId: winningReceipt.value.commandId,
      expectedVersion: 1,
    }
    const receipt = await service.take(winningCommand, operator, report.id)
    expect(receipt).toMatchObject({ commandId: winningCommand.commandId, version: 2 })
    await expect(service.reject({
      ...winningCommand,
      reason: 'Другая команда с тем же идентификатором.',
    }, operator, report.id)).rejects.toBeInstanceOf(FeedbackFailure)
  })

  test('deletes voluntary contact without deleting source or requiring recent authentication', async () => {
    const report = await createReport()
    const sourceBefore = await sourceSnapshot(report.id)
    await service.deleteContact({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2740',
      expectedVersion: 1,
    }, operator, report.id)

    expect(await prisma.feedbackReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({
      contactDeletedAt: now,
      replyEmail: null,
      version: 2,
    })
    expect(await sourceSnapshot(report.id)).toEqual(sourceBefore)

    expect(await prisma.feedbackOperatorCommand.count({ where: { reportId: report.id } })).toBe(1)
  })

  test('keeps a rejection reason in the report without duplicating it in audit metadata', async () => {
    const report = await createReport()
    const reason = 'Содержимое не относится к продукту.'
    await service.reject({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2750',
      expectedVersion: 1,
      reason,
    }, operator, report.id)

    const stored = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: report.id } })
    const audit = await prisma.feedbackAuditEvent.findFirstOrThrow({ where: { reportId: report.id } })
    const command = await prisma.feedbackOperatorCommand.findFirstOrThrow({ where: { reportId: report.id } })
    expect(stored.rejectionReason).toBe(reason)
    expect(JSON.stringify(audit.payload)).not.toContain(reason)
    expect(command.fingerprint).not.toContain(reason)
  })

  function createReport() {
    return prisma.feedbackReport.create({
      data: {
        browserClass: 'chromium',
        buildSha: 'a'.repeat(40),
        category: 'error',
        deviceClass: 'desktop',
        errorCanContinue: false,
        errorExpectedResult: 'Карточка должна открыться.',
        errorId: null,
        errorReproductionSteps: 'Открыл матч и нажал на карточку.',
        errorWhatHappened: 'Карточка не открылась.',
        linkedUserId: null,
        publicNumber: `FB-8M4Q2K7P9${Math.floor(Math.random() * 8) + 2}`,
        replyEmail: 'reply@example.com',
        routeTemplate: '/tenders/$tenderId',
      },
    })
  }

  function sourceSnapshot(reportId: string) {
    return prisma.feedbackReport.findUniqueOrThrow({
      where: { id: reportId },
      select: {
        browserClass: true,
        buildSha: true,
        category: true,
        deviceClass: true,
        errorCanContinue: true,
        errorExpectedResult: true,
        errorId: true,
        errorReproductionSteps: true,
        errorWhatHappened: true,
        linkedUserId: true,
        publicNumber: true,
        routeTemplate: true,
        suggestionDesiredChange: true,
        suggestionProblemSolved: true,
      },
    })
  }
})
