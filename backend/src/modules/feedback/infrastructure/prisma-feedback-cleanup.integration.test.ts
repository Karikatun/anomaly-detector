import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { cleanupFeedbackReports } from './prisma-feedback-cleanup'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const now = new Date('2026-08-23T12:00:00.000Z')

maybeDescribe('feedback retention cleanup', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)

  beforeEach(async () => {
    await prisma.feedbackReport.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('removes stale active and 30-day terminal or transferred source with dependent audit', async () => {
    const staleActive = await createReport('FB-2222222222', {
      createdAt: new Date('2026-02-20T12:00:00.000Z'),
      status: 'new',
    })
    await createReport('FB-2222222223', {
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      status: 'new',
    })
    await createReport('FB-2222222224', {
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      resolvedAt: new Date('2026-07-20T12:00:00.000Z'),
      status: 'resolved',
    })
    await createReport('FB-2222222225', {
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      rejectedAt: new Date('2026-07-20T12:00:00.000Z'),
      status: 'rejected',
    })
    await createReport('FB-2222222226', {
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      status: 'in_review',
      transferredAt: new Date('2026-07-20T12:00:00.000Z'),
    })
    await createReport('FB-2222222227', {
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      resolvedAt: new Date('2026-08-10T12:00:00.000Z'),
      status: 'resolved',
    })
    const commandId = '019f8099-7e26-7760-ad08-66d1d66b2720'
    await prisma.feedbackOperatorCommand.create({
      data: {
        actorId: '019f8099-7e26-7760-ad08-66d1d66b2718',
        commandId,
        fingerprint: 'a'.repeat(64),
        kind: 'take_in_review',
        receipt: { commandId, reportId: staleActive.id, version: 2 },
        reportId: staleActive.id,
      },
    })
    await prisma.feedbackAuditEvent.create({
      data: {
        actorId: '019f8099-7e26-7760-ad08-66d1d66b2718',
        commandId,
        fromVersion: 1,
        kind: 'feedback_taken_in_review',
        payload: { fromStatus: 'new', toStatus: 'in_review' },
        reportId: staleActive.id,
        toVersion: 2,
      },
    })

    expect((await cleanupFeedbackReports(prisma, now)).count).toBe(4)
    expect((await prisma.feedbackReport.findMany({
      orderBy: { publicNumber: 'asc' },
      select: { publicNumber: true },
    })).map((report) => report.publicNumber)).toEqual([
      'FB-2222222223',
      'FB-2222222227',
    ])
    expect(await prisma.feedbackOperatorCommand.count()).toBe(0)
    expect(await prisma.feedbackAuditEvent.count()).toBe(0)
  })

  function createReport(
    publicNumber: string,
    overrides: Partial<{
      createdAt: Date
      rejectedAt: Date
      resolvedAt: Date
      status: string
      transferredAt: Date
    }>,
  ) {
    return prisma.feedbackReport.create({
      data: {
        browserClass: 'chromium',
        category: 'suggestion',
        createdAt: overrides.createdAt,
        deviceClass: 'desktop',
        publicNumber,
        rejectedAt: overrides.rejectedAt,
        resolvedAt: overrides.resolvedAt,
        routeTemplate: '/profile',
        status: overrides.status,
        suggestionDesiredChange: 'Добавить краткую подсказку.',
        suggestionProblemSolved: 'Новому игроку будет проще начать.',
        transferredAt: overrides.transferredAt,
      },
    })
  }
})
