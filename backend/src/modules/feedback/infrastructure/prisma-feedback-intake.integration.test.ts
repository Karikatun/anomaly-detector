import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { FeedbackIntakeRequest } from '@anomaly-detector/contracts'

import { createPrisma } from '../../../db'
import { lockAccountLifecycleTransaction } from '../../../security/account-lifecycle-lock'
import { unlinkFeedbackAccountInTransaction } from './prisma-feedback-account-cleanup'
import { createPrismaFeedbackIntake } from './prisma-feedback-intake'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const now = new Date('2026-08-23T12:00:00.000Z')
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const fingerprintKey = 'feedback-test-secret-at-least-32-bytes'

maybeDescribe('Prisma feedback intake', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  let publicNumberIndex = 0
  const intake = createPrismaFeedbackIntake(prisma, fingerprintKey, {
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

  test('replays the original receipt before spending either feedback budget again', async () => {
    const player = await createUser('feedback-replay-player')
    const submissionId = '019f8099-7e26-7760-ad08-66d1d66b2720'

    const first = await intake.submit({
      clientAddress: '203.0.113.20',
      report: errorReport({
        expectedResult: '  Карточка должна открыться.  ',
        submissionId,
      }),
      userId: player.id,
    })
    const replay = await intake.submit({
      clientAddress: '203.0.113.21',
      report: errorReport({ submissionId }),
      userId: player.id,
    })

    expect(first).toEqual({
      kind: 'accepted',
      receipt: {
        acceptedAt: now.toISOString(),
        publicNumber: 'FB-2222222222',
      },
    })
    expect(replay).toEqual(first)
    expect(await prisma.feedbackReport.count()).toBe(1)
    const buckets = await prisma.authAbuseBucket.findMany({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1])
  })

  test('replays the original receipt after the budget key rotates without spending new budgets', async () => {
    const player = await createUser('feedback-rotated-key-replay')
    const report = errorReport({
      submissionId: '019f8099-7e26-7760-ad08-66d1d66b2725',
    })
    const first = await intake.submit({
      clientAddress: '203.0.113.27',
      report,
      userId: player.id,
    })
    const rotatedIntake = createPrismaFeedbackIntake(
      prisma,
      'rotated-feedback-secret-at-least-32-bytes',
      {
        clock: { now: () => now },
        publicNumber: () => 'FB-3333333333',
      },
    )

    const replay = await rotatedIntake.submit({
      clientAddress: '203.0.113.27',
      report,
      userId: player.id,
    })

    expect(replay).toEqual(first)
    expect(await prisma.feedbackReport.count()).toBe(1)
    const buckets = await prisma.authAbuseBucket.findMany({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1])
  })

  test('rejects a changed payload but lets the unlinked bearer replay the same receipt', async () => {
    const firstPlayer = await createUser('feedback-conflict-first')
    const otherPlayer = await createUser('feedback-conflict-other')
    const submissionId = '019f8099-7e26-7760-ad08-66d1d66b2721'

    const accepted = await intake.submit({
      clientAddress: '203.0.113.22',
      report: errorReport({ submissionId }),
      userId: firstPlayer.id,
    })
    const changedPayload = await intake.submit({
      clientAddress: '203.0.113.23',
      report: errorReport({
        submissionId,
        whatHappened: 'После повтора возникла другая ошибка.',
      }),
      userId: firstPlayer.id,
    })
    const changedUser = await intake.submit({
      clientAddress: '203.0.113.24',
      report: errorReport({ submissionId }),
      userId: otherPlayer.id,
    })

    expect(accepted.kind).toBe('accepted')
    expect(changedPayload).toEqual({ kind: 'submission_conflict' })
    expect(changedUser).toEqual(accepted)
    expect(JSON.stringify(changedPayload)).not.toContain('FB-')
    expect(await prisma.feedbackReport.count()).toBe(1)
    const buckets = await prisma.authAbuseBucket.findMany({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1])
  })

  test('rejects another authenticated user while the submission remains account-linked', async () => {
    const linkedPlayer = await createUser('feedback-linked-owner')
    const otherPlayer = await createUser('feedback-linked-other')
    const submissionId = '019f8099-7e26-7760-ad08-66d1d66b2723'

    const accepted = await intake.submit({
      clientAddress: '203.0.113.25',
      report: errorReport({ linkAccount: true, submissionId }),
      userId: linkedPlayer.id,
    })
    const otherUser = await intake.submit({
      clientAddress: '203.0.113.26',
      report: errorReport({ linkAccount: true, submissionId }),
      userId: otherPlayer.id,
    })

    expect(accepted.kind).toBe('accepted')
    expect(otherUser).toEqual({ kind: 'submission_conflict' })
    expect(JSON.stringify(otherUser)).not.toContain('FB-')
    expect(await prisma.feedbackReport.count()).toBe(1)
  })

  test('serializes concurrent retries into one report and one budget spend', async () => {
    const player = await createUser('feedback-concurrent-replay')
    const report = errorReport({
      submissionId: '019f8099-7e26-7760-ad08-66d1d66b2722',
    })

    const outcomes = await Promise.all([
      intake.submit({ clientAddress: '198.51.100.50', report, userId: player.id }),
      intake.submit({ clientAddress: '198.51.100.50', report, userId: player.id }),
    ])

    expect(outcomes[0]).toEqual(outcomes[1])
    expect(outcomes[0]?.kind).toBe('accepted')
    expect(await prisma.feedbackReport.count()).toBe(1)
    const buckets = await prisma.authAbuseBucket.findMany({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 1])
  })

  test('waits for account deletion and never links an already anonymized account', async () => {
    const player = await createUser('feedback-delete-race')
    let allowDeletionCommit = () => {}
    const deletionMayCommit = new Promise<void>((resolve) => {
      allowDeletionCommit = resolve
    })
    let deletionLocked = () => {}
    const deletionHasLock = new Promise<void>((resolve) => {
      deletionLocked = resolve
    })

    const deletion = prisma.$transaction(async (transaction) => {
      await lockAccountLifecycleTransaction(transaction, fingerprintKey, player.id)
      await unlinkFeedbackAccountInTransaction(transaction, player.id)
      await transaction.user.update({
        where: { id: player.id },
        data: { anonymizedAt: now },
      })
      deletionLocked()
      await deletionMayCommit
    })
    await deletionHasLock

    let submissionSettled = false
    const submission = intake.submit({
      clientAddress: '198.51.100.51',
      report: errorReport({
        linkAccount: true,
        submissionId: '019f8099-7e26-7760-ad08-66d1d66b2724',
      }),
      userId: player.id,
    }).finally(() => {
      submissionSettled = true
    })

    try {
      await waitForAdvisoryLockWait()
      expect(submissionSettled).toBe(false)
    } finally {
      allowDeletionCommit()
    }

    await deletion
    expect(await submission).toEqual({ kind: 'account_unavailable' })
    expect(await prisma.feedbackReport.count()).toBe(0)
    expect(await prisma.authAbuseBucket.count({
      where: { scope: { in: ['feedback_account_day', 'feedback_ip_day'] } },
    })).toBe(0)
  })

  function createUser(login: string) {
    return prisma.user.create({
      data: { login, passwordHash: 'not-used-in-this-test' },
    })
  }

  async function waitForAdvisoryLockWait() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [state] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*)::bigint AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event = 'advisory'
      `
      if ((state?.waiting ?? 0n) > 0n) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for Feedback intake to block on the account lifecycle lock')
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
    submissionId: randomUUID(),
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
