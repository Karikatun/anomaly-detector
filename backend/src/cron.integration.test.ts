import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { runCronTask } from './cron'
import {
  createPrisma,
  isRetryableDatabaseTransactionConflict,
} from './db'
import { cleanupExpiredAuthRecovery } from './modules/auth'
import {
  cancelQueuedTransactionalMail,
  cleanupExpiredPendingMailOutbox,
  createTransactionalMailRequester,
} from './modules/mail'
import type { BackendRuntime } from './runtime'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('maintenance cleanup integration', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)

  beforeEach(async () => {
    await prisma.mailDeliveryAttempt.deleteMany()
    await prisma.mailOutboxMessage.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('atomically removes every expired recovery artifact and redacts pending mail', async () => {
    const now = new Date(Date.now() + 24 * 60 * 60_000)
    const expiredAt = new Date(now.getTime() - 1)
    const futureAt = new Date(now.getTime() + 60 * 60_000)
    const expiredMessageIds = [
      '019f8099-7e26-7760-ad08-66d1d66b2901',
      '019f8099-7e26-7760-ad08-66d1d66b2902',
      '019f8099-7e26-7760-ad08-66d1d66b2903',
      '019f8099-7e26-7760-ad08-66d1d66b2904',
      '019f8099-7e26-7760-ad08-66d1d66b2905',
      '019f8099-7e26-7760-ad08-66d1d66b2906',
    ]
    const activeMessageId = '019f8099-7e26-7760-ad08-66d1d66b2907'
    const staleSecurityMessageId = '019f8099-7e26-7760-ad08-66d1d66b2908'
    const partialExpiredMessageId = '019f8099-7e26-7760-ad08-66d1d66b2909'
    const partialFutureMessageId = '019f8099-7e26-7760-ad08-66d1d66b2910'
    const expiredUser = await prisma.user.create({
      data: { login: 'cleanup-expired-recovery' },
    })
    const activeUser = await prisma.user.create({
      data: { login: 'cleanup-active-recovery' },
    })
    const partialUser = await prisma.user.create({
      data: { login: 'cleanup-partial-replacement' },
    })
    const session = await prisma.authSession.create({
      data: {
        expiresAt: futureAt,
        refreshTokenHash: 'cleanup-expired-recovery-session',
        userId: expiredUser.id,
      },
    })
    const partialSession = await prisma.authSession.create({
      data: {
        expiresAt: futureAt,
        refreshTokenHash: 'cleanup-partial-replacement-session',
        userId: partialUser.id,
      },
    })

    await prisma.recoveryEmailChallenge.create({
      data: {
        canonicalKey: 'challenge@example.test',
        codeHash: 'a'.repeat(64),
        expiresAt: expiredAt,
        messageId: expiredMessageIds[0],
        policyVersion: 1,
        providerValue: 'challenge@example.test',
        requestedAt: expiredAt,
        userId: expiredUser.id,
      },
    })
    await prisma.recoveryEmailReplacement.create({
      data: {
        newCanonicalKey: 'replacement-new@example.test',
        newCodeHash: 'b'.repeat(64),
        newExpiresAt: expiredAt,
        newMessageId: expiredMessageIds[2],
        newPolicyVersion: 1,
        newProviderValue: 'replacement-new@example.test',
        oldCanonicalKey: 'replacement-old@example.test',
        oldCodeHash: 'c'.repeat(64),
        oldExpiresAt: expiredAt,
        oldMessageId: expiredMessageIds[1],
        oldProviderValue: 'replacement-old@example.test',
        requestedAt: expiredAt,
        requestingSessionId: session.id,
        userId: expiredUser.id,
      },
    })
    await prisma.recoveryCodeReissueChallenge.create({
      data: {
        codeHash: 'd'.repeat(64),
        expiresAt: expiredAt,
        messageId: expiredMessageIds[3],
        recoveryCanonicalKey: 'reissue@example.test',
        requestedAt: expiredAt,
        requestingSessionId: session.id,
        userId: expiredUser.id,
      },
    })
    await prisma.recoveryCodeEmailReplacement.create({
      data: {
        newCanonicalKey: 'code-new@example.test',
        newCodeHash: 'e'.repeat(64),
        newExpiresAt: expiredAt,
        newMessageId: expiredMessageIds[4],
        newPolicyVersion: 1,
        newProviderValue: 'code-new@example.test',
        oldCanonicalKey: 'code-old@example.test',
        oldProviderValue: 'code-old@example.test',
        requestedAt: expiredAt,
        userId: expiredUser.id,
      },
    })
    await prisma.passwordResetCredential.create({
      data: {
        expiresAt: expiredAt,
        messageId: expiredMessageIds[5],
        recoveryCanonicalKey: 'reset@example.test',
        requestedAt: expiredAt,
        tokenHash: 'f'.repeat(64),
        userId: expiredUser.id,
      },
    })
    await prisma.recoveryEmailChallenge.create({
      data: {
        canonicalKey: 'active@example.test',
        codeHash: '1'.repeat(64),
        expiresAt: futureAt,
        messageId: activeMessageId,
        policyVersion: 1,
        providerValue: 'active@example.test',
        requestedAt: now,
        userId: activeUser.id,
      },
    })
    await prisma.recoveryEmailReplacement.create({
      data: {
        newCanonicalKey: 'partial-new@example.test',
        newCodeHash: '2'.repeat(64),
        newExpiresAt: futureAt,
        newMessageId: partialFutureMessageId,
        newPolicyVersion: 1,
        newProviderValue: 'partial-new@example.test',
        oldCanonicalKey: 'partial-old@example.test',
        oldCodeHash: '3'.repeat(64),
        oldExpiresAt: expiredAt,
        oldMessageId: partialExpiredMessageId,
        oldProviderValue: 'partial-old@example.test',
        requestedAt: expiredAt,
        requestingSessionId: partialSession.id,
        userId: partialUser.id,
      },
    })

    await prisma.mailOutboxMessage.createMany({
      data: [
        ...expiredMessageIds.map((messageId, index) => ({
          createdAt: now,
          fingerprint: `${index}`.repeat(64),
          messageId,
          providerMessageId: `<${messageId}@anomaly-detector.ru>`,
          recipient: `expired-${index}@example.test`,
          recipientDomain: 'example.test',
          templateKind: index === 5
            ? 'password_recovery'
            : 'account_email_confirmation',
          templatePayload: index === 5
            ? {
                expiresAt: expiredAt.toISOString(),
                kind: 'password_recovery',
                recoveryUrl: 'https://anomaly-detector.ru/recover/password',
              }
            : {
                expiresAt: expiredAt.toISOString(),
                kind: 'account_email_confirmation',
              },
          ...(index === 1
            ? {
                attemptCount: 1,
                leaseExpiresAt: futureAt,
                leaseOwner: 'cleanup-in-flight-worker',
                state: 'leased',
              }
            : {}),
        })),
        {
          createdAt: now,
          fingerprint: '7'.repeat(64),
          messageId: activeMessageId,
          providerMessageId: `<${activeMessageId}@anomaly-detector.ru>`,
          recipient: 'active@example.test',
          recipientDomain: 'example.test',
          templateKind: 'account_email_confirmation',
          templatePayload: {
            expiresAt: futureAt.toISOString(),
            kind: 'account_email_confirmation',
          },
        },
        {
          createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
          fingerprint: '8'.repeat(64),
          messageId: staleSecurityMessageId,
          providerMessageId: `<${staleSecurityMessageId}@anomaly-detector.ru>`,
          recipient: 'security@example.test',
          recipientDomain: 'example.test',
          templateKind: 'security_notification',
          templatePayload: {
            event: 'password_changed',
            kind: 'security_notification',
            occurredAt: new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
          },
        },
        {
          createdAt: now,
          fingerprint: '9'.repeat(64),
          messageId: partialExpiredMessageId,
          providerMessageId: `<${partialExpiredMessageId}@anomaly-detector.ru>`,
          recipient: 'partial-old@example.test',
          recipientDomain: 'example.test',
          templateKind: 'account_email_confirmation',
          templatePayload: {
            addressRole: 'recovery',
            expiresAt: expiredAt.toISOString(),
            kind: 'account_email_confirmation',
            recoveryPurpose: 'replacement_old',
          },
        },
        {
          createdAt: now,
          fingerprint: 'a'.repeat(64),
          messageId: partialFutureMessageId,
          providerMessageId: `<${partialFutureMessageId}@anomaly-detector.ru>`,
          recipient: 'partial-new@example.test',
          recipientDomain: 'example.test',
          templateKind: 'account_email_confirmation',
          templatePayload: {
            addressRole: 'recovery',
            expiresAt: futureAt.toISOString(),
            kind: 'account_email_confirmation',
            recoveryPurpose: 'replacement_new',
          },
        },
      ],
    })

    const runtime = {
      env: {
        MAIL_OUTBOX_RETENTION_DAYS: 30,
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
      },
      prisma,
    } as unknown as BackendRuntime
    await runCronTask('maintenance:cleanup', runtime, now)

    expect(await prisma.recoveryEmailChallenge.count({
      where: { userId: expiredUser.id },
    })).toBe(0)
    expect(await prisma.recoveryEmailReplacement.count({
      where: { userId: expiredUser.id },
    })).toBe(0)
    expect(await prisma.recoveryCodeReissueChallenge.count({
      where: { userId: expiredUser.id },
    })).toBe(0)
    expect(await prisma.recoveryCodeEmailReplacement.count({
      where: { userId: expiredUser.id },
    })).toBe(0)
    expect(await prisma.passwordResetCredential.count({
      where: { userId: expiredUser.id },
    })).toBe(0)
    expect(await prisma.recoveryEmailChallenge.count({
      where: { userId: activeUser.id },
    })).toBe(1)
    expect(await prisma.recoveryEmailReplacement.count({
      where: { userId: partialUser.id },
    })).toBe(1)
    expect(await prisma.recoveryEmailReplacement.findUniqueOrThrow({
      where: { userId: partialUser.id },
      select: { newCodeHash: true, oldCodeHash: true },
    })).toEqual({
      newCodeHash: '2'.repeat(64),
      oldCodeHash: '0'.repeat(64),
    })
    expect(await prisma.mailOutboxMessage.count({
      where: {
        messageId: {
          in: [
            ...expiredMessageIds,
            staleSecurityMessageId,
            partialExpiredMessageId,
          ],
        },
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: { equals: {} },
      },
    })).toBe(8)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: activeMessageId },
      select: { recipient: true, state: true },
    })).toEqual({ recipient: 'active@example.test', state: 'queued' })
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: partialFutureMessageId },
      select: { recipient: true, state: true },
    })).toEqual({ recipient: 'partial-new@example.test', state: 'queued' })
    expect(await prisma.mailDeliveryAttempt.count({
      where: { failureCode: 'retention_expired' },
    })).toBe(8)

    await runCronTask('maintenance:cleanup', runtime, now)
    expect(await prisma.mailDeliveryAttempt.count({
      where: { failureCode: 'retention_expired' },
    })).toBe(8)
  })

  test('rolls back recovery deletion and mail redaction as one retention unit', async () => {
    const now = new Date(Date.now() + 24 * 60 * 60_000)
    const messageId = '019f8099-7e26-7760-ad08-66d1d66b2911'
    const user = await prisma.user.create({
      data: { login: 'cleanup-rollback-recovery' },
    })
    await prisma.recoveryEmailChallenge.create({
      data: {
        canonicalKey: 'rollback@example.test',
        codeHash: '4'.repeat(64),
        expiresAt: new Date(now.getTime() - 1),
        messageId,
        policyVersion: 1,
        providerValue: 'rollback@example.test',
        requestedAt: new Date(now.getTime() - 1),
        userId: user.id,
      },
    })
    await prisma.mailOutboxMessage.create({
      data: {
        createdAt: now,
        fingerprint: 'b'.repeat(64),
        messageId,
        providerMessageId: `<${messageId}@anomaly-detector.ru>`,
        recipient: 'rollback@example.test',
        recipientDomain: 'example.test',
        templateKind: 'account_email_confirmation',
        templatePayload: {
          expiresAt: new Date(now.getTime() - 1).toISOString(),
          kind: 'account_email_confirmation',
        },
      },
    })

    await expect(prisma.$transaction(async (tx) => {
      await cleanupExpiredPendingMailOutbox(tx, now)
      await cleanupExpiredAuthRecovery(tx, now)
      throw new Error('retention cleanup rolled back')
    })).rejects.toThrow('retention cleanup rolled back')

    expect(await prisma.recoveryEmailChallenge.count({
      where: { userId: user.id },
    })).toBe(1)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId },
      select: { recipient: true, state: true },
    })).toEqual({ recipient: 'rollback@example.test', state: 'queued' })
    expect(await prisma.mailDeliveryAttempt.count()).toBe(0)
  })

  test('retries a recovery-first resend racing mail-first cleanup', async () => {
    const now = new Date(Date.now() + 24 * 60 * 60_000)
    const futureAt = new Date(now.getTime() + 15 * 60_000)
    const oldMessageId = '019f8099-7e26-7760-ad08-66d1d66b2912'
    const newMessageId = '019f8099-7e26-7760-ad08-66d1d66b2913'
    const resentMessageId = '019f8099-7e26-7760-ad08-66d1d66b2914'
    const user = await prisma.user.create({
      data: { login: 'cleanup-concurrent-resend' },
    })
    const session = await prisma.authSession.create({
      data: {
        expiresAt: futureAt,
        refreshTokenHash: 'cleanup-concurrent-resend-session',
        userId: user.id,
      },
    })
    await prisma.recoveryEmailReplacement.create({
      data: {
        newCanonicalKey: 'concurrent-new@example.test',
        newCodeHash: '6'.repeat(64),
        newExpiresAt: new Date(now.getTime() - 1),
        newMessageId,
        newPolicyVersion: 1,
        newProviderValue: 'concurrent-new@example.test',
        oldCanonicalKey: 'concurrent-old@example.test',
        oldCodeHash: '5'.repeat(64),
        oldExpiresAt: new Date(now.getTime() - 1),
        oldMessageId,
        oldProviderValue: 'concurrent-old@example.test',
        requestedAt: new Date(now.getTime() - 1),
        requestingSessionId: session.id,
        userId: user.id,
      },
    })
    await prisma.mailOutboxMessage.createMany({
      data: [oldMessageId, newMessageId].map((messageId, index) => ({
        createdAt: now,
        fingerprint: `${index + 7}`.repeat(64),
        messageId,
        providerMessageId: `<${messageId}@anomaly-detector.ru>`,
        recipient: `concurrent-${index}@example.test`,
        recipientDomain: 'example.test',
        templateKind: 'account_email_confirmation',
        templatePayload: {
          addressRole: 'recovery',
          expiresAt: new Date(now.getTime() - 1).toISOString(),
          kind: 'account_email_confirmation',
          recoveryPurpose: index === 0 ? 'replacement_old' : 'replacement_new',
        },
      })),
    })

    const runtime = {
      env: {
        MAIL_OUTBOX_RETENTION_DAYS: 30,
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
      },
      prisma,
    } as unknown as BackendRuntime
    let releaseRecoveryFirstTransaction!: () => void
    const recoveryFirstTransactionReleased = new Promise<void>((resolve) => {
      releaseRecoveryFirstTransaction = resolve
    })
    let recoveryRowLocked!: () => void
    const recoveryRowLockedPromise = new Promise<void>((resolve) => {
      recoveryRowLocked = resolve
    })
    const resend = retryTransactionConflict(async (attempt) => prisma.$transaction(async (tx) => {
      const updated = await tx.recoveryEmailReplacement.updateMany({
        where: { userId: user.id },
        data: {
          oldCodeHash: '7'.repeat(64),
          oldExpiresAt: futureAt,
          oldMessageId: resentMessageId,
        },
      })
      if (updated.count === 0) return false
      if (attempt === 0) {
        recoveryRowLocked()
        await recoveryFirstTransactionReleased
      }
      await cancelQueuedTransactionalMail(tx, { messageId: oldMessageId, now })
      await createTransactionalMailRequester(tx, 'retention-race-fingerprint-key-0001').enqueue({
        messageId: resentMessageId,
        recipient: 'concurrent-old@example.test',
        template: {
          addressRole: 'recovery',
          expiresAt: futureAt,
          kind: 'account_email_confirmation',
          recoveryPurpose: 'replacement_old',
        },
      })
      return true
    }))
    await recoveryRowLockedPromise

    const cleanup = runCronTask('maintenance:cleanup', runtime, now)
    try {
      await waitForDatabaseLockWaiter(prisma)
    } finally {
      releaseRecoveryFirstTransaction()
    }
    const [, resent] = await Promise.all([cleanup, resend])

    const replacement = await prisma.recoveryEmailReplacement.findUnique({
      where: { userId: user.id },
      select: {
        newCodeHash: true,
        oldCodeHash: true,
        oldExpiresAt: true,
        oldMessageId: true,
      },
    })
    if (replacement) {
      expect(resent).toBe(true)
      expect(replacement).toEqual({
        newCodeHash: '0'.repeat(64),
        oldCodeHash: '7'.repeat(64),
        oldExpiresAt: futureAt,
        oldMessageId: resentMessageId,
      })
      expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
        where: { messageId: resentMessageId },
        select: { recipient: true, state: true },
      })).toEqual({ recipient: 'concurrent-old@example.test', state: 'queued' })
    } else {
      expect(resent).toBe(false)
      expect(await prisma.mailOutboxMessage.findUnique({
        where: { messageId: resentMessageId },
      })).toBeNull()
    }
    expect(await prisma.mailOutboxMessage.count({
      where: {
        messageId: { in: [oldMessageId, newMessageId] },
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: { equals: {} },
      },
    })).toBe(2)
  })
})

async function retryTransactionConflict<T>(
  operation: (attempt: number) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (!isRetryableDatabaseTransactionConflict(error) || attempt >= 2) throw error
      await Bun.sleep(10 * (2 ** attempt))
    }
  }

  throw new Error('Unreachable test transaction retry state')
}

async function waitForDatabaseLockWaiter(prisma: ReturnType<typeof createPrisma>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [result] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting
      FROM pg_locks
      WHERE NOT granted AND pid <> pg_backend_pid()
    `
    if ((result?.waiting ?? 0n) > 0n) return
    await Bun.sleep(10)
  }
  throw new Error('Expected retention cleanup to wait for the mail-first transaction')
}
