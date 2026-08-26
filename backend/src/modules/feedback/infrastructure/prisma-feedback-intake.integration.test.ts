import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { FeedbackIntakeRequest } from '@anomaly-detector/contracts'

import { createPrisma } from '../../../db'
import { createPrismaFeedbackIntake } from './prisma-feedback-intake'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const now = new Date('2026-08-23T12:00:00.000Z')
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

maybeDescribe('Prisma feedback intake', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  let publicNumberIndex = 0
  const intake = createPrismaFeedbackIntake(prisma, 'feedback-test-secret-at-least-32-bytes', {
    clock: { now: () => now },
    publicNumber: () => `FB-222222222${alphabet[publicNumberIndex++]}`,
  })

  beforeEach(async () => {
    publicNumberIndex = 0
    await prisma.feedbackReport.deleteMany()
    await prisma.authAbuseBucket.deleteMany({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('stores only approved source fields and HMAC budget identities', async () => {
    const player = await createUser('feedback-player')

    const result = await intake.submit({
      clientAddress: '203.0.113.10',
      report: errorReport({ linkAccount: false, replyEmail: 'reply@example.com' }),
      userId: player.id,
    })

    expect(result).toEqual({
      kind: 'accepted',
      receipt: {
        acceptedAt: now.toISOString(),
        publicNumber: 'FB-2222222222',
      },
    })
    const stored = await prisma.feedbackReport.findUniqueOrThrow({
      where: { publicNumber: 'FB-2222222222' },
    })
    expect(stored).toMatchObject({
      category: 'error',
      errorCanContinue: false,
      errorExpectedResult: 'Карточка должна открыться.',
      errorReproductionSteps: 'Открыл матч и нажал на карточку.',
      errorWhatHappened: 'Карточка не открылась.',
      linkedUserId: null,
      replyEmail: 'reply@example.com',
      routeTemplate: '/tenders/$tenderId',
      status: 'new',
      version: 1,
    })
    expect(stored).not.toHaveProperty('ipAddress')
    const buckets = await prisma.authAbuseBucket.findMany({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })
    expect(buckets).toHaveLength(2)
    expect(JSON.stringify(buckets)).not.toContain(player.id)
    expect(JSON.stringify(buckets)).not.toContain('203.0.113.10')
  })

  test('atomically accepts at most five reports per account under concurrency', async () => {
    const player = await createUser('feedback-account-budget')

    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => intake.submit({
      clientAddress: `203.0.113.${index + 1}`,
      report: errorReport(),
      userId: player.id,
    })))

    expect(outcomes.filter((outcome) => outcome.kind === 'accepted')).toHaveLength(5)
    expect(outcomes.filter((outcome) => outcome.kind === 'rate_limited')).toHaveLength(1)
    expect(await prisma.feedbackReport.count()).toBe(5)
    const accountBucket = await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'feedback_account_day' },
    })
    expect(accountBucket.count).toBe(5)
  })

  test('atomically accepts at most twenty reports per trusted IP under concurrency', async () => {
    const players = await Promise.all(Array.from({ length: 21 }, (_, index) =>
      createUser(`feedback-ip-budget-${index}`)))

    const outcomes = await Promise.all(players.map((player) => intake.submit({
      clientAddress: '198.51.100.44',
      report: errorReport(),
      userId: player.id,
    })))

    expect(outcomes.filter((outcome) => outcome.kind === 'accepted')).toHaveLength(20)
    expect(outcomes.filter((outcome) => outcome.kind === 'rate_limited')).toHaveLength(1)
    expect(await prisma.feedbackReport.count()).toBe(20)
    const ipBucket = await prisma.authAbuseBucket.findFirstOrThrow({
      where: { scope: 'feedback_ip_day' },
    })
    expect(ipBucket.count).toBe(20)
  })

  test('stores account linkage only by explicit choice and removes it on account deletion', async () => {
    const player = await createUser('feedback-linked-player')
    const result = await intake.submit({
      clientAddress: '203.0.113.11',
      report: errorReport({ linkAccount: true, replyEmail: null }),
      userId: player.id,
    })
    expect(result.kind).toBe('accepted')

    expect(await prisma.feedbackReport.findFirstOrThrow()).toMatchObject({
      linkedUserId: player.id,
      replyEmail: null,
    })
    await prisma.user.delete({ where: { id: player.id } })
    expect(await prisma.feedbackReport.findFirstOrThrow()).toMatchObject({
      linkedUserId: null,
      replyEmail: null,
    })
  })

  function createUser(login: string) {
    return prisma.user.create({
      data: { login, passwordHash: 'not-used-in-this-test' },
    })
  }
})

function errorReport(overrides: Partial<FeedbackIntakeRequest> = {}): FeedbackIntakeRequest {
  return {
    category: 'error',
    canContinue: false,
    expectedResult: 'Карточка должна открыться.',
    linkAccount: false,
    replyEmail: null,
    reproductionSteps: 'Открыл матч и нажал на карточку.',
    technicalContext: {
      browserClass: 'chromium',
      buildSha: 'a'.repeat(40),
      deviceClass: 'desktop',
      errorId: null,
      routeTemplate: '/tenders/$tenderId',
    },
    whatHappened: 'Карточка не открылась.',
    ...overrides,
  } as FeedbackIntakeRequest
}
