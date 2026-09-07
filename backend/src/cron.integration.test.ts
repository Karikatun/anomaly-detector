import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { runCronTask } from './cron'
import {
  accountDeletionClaimLeaseMs,
  claimDeletedAccountCleanupBatch,
  operatorAuditActorCleanupBatchSize,
  reconcileDeletedAccount,
  reconcileDeletedAccounts,
} from './account-deletion-reconciliation'
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
import { createPersistentTenderModule } from './modules/tender'
import type { BackendRuntime } from './runtime'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('maintenance cleanup integration', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)

  beforeEach(async () => {
    await prisma.mailDeliveryAttempt.deleteMany()
    await prisma.mailOutboxMessage.deleteMany()
    await prisma.mailPolicyAuditEvent.deleteMany()
    await prisma.mailPolicyCommand.deleteMany()
    await prisma.mailPolicyEntry.deleteMany()
    await prisma.mailPolicyVersion.deleteMany()
    await prisma.tenderRoom.deleteMany()
    await prisma.tender.deleteMany()
    await prisma.feedbackReport.deleteMany()
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

  test('reconciles legacy account-deletion tombstones without retaining player links', async () => {
    const now = new Date('2026-09-04T15:00:00.000Z')
    const deletedAccount = await prisma.user.create({
      data: {
        anonymizedAt: new Date('2026-08-01T12:00:00.000Z'),
        deletionCleanupAvailableAt: new Date('2026-08-01T12:00:00.000Z'),
        deletionCleanupCompletedAt: null,
        displayName: null,
        login: 'deleted-legacy-account',
        passwordHash: null,
        tutorialCompletedAt: new Date('2026-07-01T12:00:00.000Z'),
      },
    })
    const remainingAccount = await prisma.user.create({
      data: { displayName: 'Оставшийся участник', login: 'legacy-room-peer' },
    })
    const tender = createPersistentTenderModule(prisma)
    const { tenderId } = await tender.createTender({
      players: [
        {
          displayName: 'Deleted participant',
          id: deletedAccount.id,
          tiePriority: 1,
        },
        {
          displayName: 'Оставшийся участник',
          id: remainingAccount.id,
          tiePriority: 2,
        },
      ],
    })
    const room = await prisma.tenderRoom.create({
      data: {
        capacity: 2,
        createdAt: now,
        hostId: deletedAccount.id,
        joinCode: 'LEGACY0001',
        members: {
          create: {
            ready: true,
            seat: 2,
            userId: remainingAccount.id,
          },
        },
        currentMatches: {
          create: { userId: remainingAccount.id },
        },
        startsAt: new Date(now.getTime() + 10_000),
        status: 'starting',
      },
    })
    const feedback = await prisma.feedbackReport.create({
      data: {
        browserClass: 'chromium',
        category: 'suggestion',
        createdAt: now,
        deviceClass: 'desktop',
        linkedUserId: deletedAccount.id,
        publicNumber: 'FB-LEGACY001',
        routeTemplate: '/profile',
        suggestionDesiredChange: 'Удалить старую связь.',
        suggestionProblemSolved: 'История удаления останется обезличенной.',
      },
    })
    const feedbackCommandId = '019f8099-7e26-7760-ad08-66d1d66b2a01'
    const feedbackReceipt = {
      commandId: feedbackCommandId,
      reportId: feedback.id,
      version: 2,
    }
    await prisma.feedbackOperatorCommand.create({
      data: {
        actorId: deletedAccount.id,
        commandId: feedbackCommandId,
        fingerprint: 'a'.repeat(64),
        kind: 'take_in_review',
        receipt: feedbackReceipt,
        reportId: feedback.id,
      },
    })
    await prisma.feedbackAuditEvent.create({
      data: {
        actorId: deletedAccount.id,
        commandId: feedbackCommandId,
        fromVersion: 1,
        kind: 'feedback_taken_in_review',
        payload: { fromStatus: 'new', toStatus: 'in_review' },
        reportId: feedback.id,
        toVersion: 2,
      },
    })
    const mailCommandId = '019f8099-7e26-7760-ad08-66d1d66b2a02'
    const mailReceipt = { kind: 'catalog_synced', version: 1 }
    await prisma.mailPolicyVersion.create({
      data: {
        catalogVersion: 1,
        providerCatalog: {
          providers: [{
            customDomain: null,
            displayName: 'Test Mail',
            evidenceUrl: 'https://example.com/mail',
            providerId: 'vk_mail',
            publicDomains: [{
              canonicalization: {
                ignoreDots: false,
                localPartCaseInsensitive: false,
                stripPlusTag: false,
              },
              emailDomain: 'mail.ru',
            }],
            reason: null,
            state: 'approved',
          }],
          version: 1,
        },
        publishedBy: deletedAccount.id,
        publishedAt: now,
        version: 1,
      },
    })
    await prisma.mailPolicyCommand.create({
      data: {
        actorId: deletedAccount.id,
        commandId: mailCommandId,
        fingerprint: 'b'.repeat(64),
        kind: 'sync_catalog',
        receipt: mailReceipt,
      },
    })
    await prisma.mailPolicyAuditEvent.create({
      data: {
        actorId: deletedAccount.id,
        commandId: mailCommandId,
        kind: 'mail_provider_catalog_synced',
        payload: { catalogVersion: 1, previousVersion: 0, version: 1 },
      },
    })
    const runtime = {
      env: {
        JWT_SECRET: 'test-account-lifecycle-secret-0001',
        MAIL_OUTBOX_RETENTION_DAYS: 30,
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
      },
      prisma,
    } as unknown as BackendRuntime

    await runCronTask('accounts:deletion-reconcile', runtime, now)

    expect(await prisma.user.findUniqueOrThrow({
      where: { id: deletedAccount.id },
      select: { deletionCleanupCompletedAt: true, tutorialCompletedAt: true },
    })).toEqual({
      deletionCleanupCompletedAt: expect.any(Date),
      tutorialCompletedAt: null,
    })
    expect(await prisma.feedbackReport.findUniqueOrThrow({
      where: { id: feedback.id },
      select: { linkedUserId: true },
    })).toEqual({ linkedUserId: null })
    expect(await prisma.tenderRoom.findUniqueOrThrow({
      where: { id: room.id },
      select: {
        hostId: true,
        members: { select: { ready: true, userId: true } },
        startsAt: true,
        status: true,
      },
    })).toEqual({
      hostId: remainingAccount.id,
      members: [{ ready: false, userId: remainingAccount.id }],
      startsAt: null,
      status: 'waiting',
    })
    expect(await prisma.currentMatch.count({ where: { userId: deletedAccount.id } })).toBe(0)
    const persistedTender = await prisma.tender.findUniqueOrThrow({
      where: { id: tenderId },
      select: { state: true },
    })
    expect(JSON.stringify(persistedTender.state)).not.toContain(deletedAccount.id)
    expect(JSON.stringify(persistedTender.state)).toContain('deleted-participant-')
    const feedbackCommand = await prisma.feedbackOperatorCommand.findUniqueOrThrow({
      where: { commandId: feedbackCommandId },
    })
    const feedbackAudit = await prisma.feedbackAuditEvent.findUniqueOrThrow({
      where: { commandId: feedbackCommandId },
    })
    const mailPolicy = await prisma.mailPolicyVersion.findUniqueOrThrow({
      where: { version: 1 },
    })
    const mailCommand = await prisma.mailPolicyCommand.findUniqueOrThrow({
      where: { commandId: mailCommandId },
    })
    const mailAudit = await prisma.mailPolicyAuditEvent.findUniqueOrThrow({
      where: { commandId: mailCommandId },
    })
    const pseudonymousActorIds = [
      feedbackCommand.actorId,
      feedbackAudit.actorId,
      mailPolicy.publishedBy,
      mailCommand.actorId,
      mailAudit.actorId,
    ]
    expect(new Set(pseudonymousActorIds).size).toBe(1)
    expect(pseudonymousActorIds[0]).not.toBe(deletedAccount.id)
    expect(pseudonymousActorIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(feedbackCommand.receipt).toEqual(feedbackReceipt)
    expect(mailCommand.receipt).toEqual(mailReceipt)
    expect(JSON.stringify({
      feedbackAudit: feedbackAudit.payload,
      feedbackFingerprint: feedbackCommand.fingerprint,
      feedbackReceipt: feedbackCommand.receipt,
      mailAudit: mailAudit.payload,
      mailCatalog: mailPolicy.providerCatalog,
      mailFingerprint: mailCommand.fingerprint,
      mailReceipt: mailCommand.receipt,
    })).not.toContain(deletedAccount.id)
  })

  test('resumes bounded operator-audit anonymization with one temporary pseudonym', async () => {
    const now = new Date('2026-09-04T15:30:00.000Z')
    const accountId = crypto.randomUUID()
    const deletedAccount = await prisma.user.create({
      data: {
        anonymizedAt: now,
        deletionCleanupAvailableAt: now,
        deletionCleanupCompletedAt: null,
        displayName: null,
        login: `deleted-${accountId}`,
        passwordHash: null,
      },
    })
    await prisma.mailPolicyCommand.createMany({
      data: Array.from(
        { length: operatorAuditActorCleanupBatchSize + 1 },
        () => ({
          actorId: deletedAccount.id,
          commandId: crypto.randomUUID(),
          fingerprint: 'c'.repeat(64),
          kind: 'sync_catalog',
          receipt: { kind: 'catalog_synced', version: 1 },
        }),
      ),
    })

    await expect(reconcileDeletedAccount({
      db: prisma,
      lifecycleSecret: 'test-account-lifecycle-secret-0001',
      now,
    }, deletedAccount.id)).resolves.toMatchObject({ completed: false })
    const pendingAccount = await prisma.user.findUniqueOrThrow({
      where: { id: deletedAccount.id },
      select: { deletionAuditPseudonym: true, deletionCleanupCompletedAt: true },
    })
    expect(pendingAccount.deletionAuditPseudonym).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(pendingAccount.deletionCleanupCompletedAt).toBeNull()
    expect(await prisma.mailPolicyCommand.count({
      where: { actorId: deletedAccount.id },
    })).toBe(1)
    expect(await prisma.mailPolicyCommand.count({
      where: { actorId: pendingAccount.deletionAuditPseudonym! },
    })).toBe(operatorAuditActorCleanupBatchSize)

    const completedAt = new Date(now.getTime() + 60_000)
    await expect(reconcileDeletedAccount({
      db: prisma,
      lifecycleSecret: 'test-account-lifecycle-secret-0001',
      now: completedAt,
    }, deletedAccount.id)).resolves.toMatchObject({ completed: true })
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: deletedAccount.id },
      select: { deletionAuditPseudonym: true, deletionCleanupCompletedAt: true },
    })).toEqual({ deletionAuditPseudonym: null, deletionCleanupCompletedAt: completedAt })
    expect(await prisma.mailPolicyCommand.count({
      where: { actorId: deletedAccount.id },
    })).toBe(0)
    expect(await prisma.mailPolicyCommand.count({
      where: { actorId: pendingAccount.deletionAuditPseudonym! },
    })).toBe(operatorAuditActorCleanupBatchSize + 1)
  })

  test('commits one Tender cleanup at a time and leaves a durable marker for the next pass', async () => {
    const now = new Date('2026-09-04T16:00:00.000Z')
    const deletedAccount = await prisma.user.create({
      data: {
        anonymizedAt: now,
        deletionCleanupAvailableAt: now,
        deletionCleanupCompletedAt: null,
        displayName: null,
        login: 'deleted-resumable-account',
        passwordHash: null,
      },
    })
    const peers = await Promise.all([0, 1, 2].map((index) => prisma.user.create({
      data: { login: `resumable-peer-${index}` },
    })))
    const tender = createPersistentTenderModule(prisma)
    for (const peer of peers) {
      const { tenderId } = await tender.createTender({
        players: [
          { id: deletedAccount.id, tiePriority: 1 },
          { id: peer.id, tiePriority: 2 },
        ],
      })
      await prisma.tenderRoom.create({
        data: {
          capacity: 2,
          hostId: deletedAccount.id,
          members: {
            create: [
              { ready: true, seat: 1, userId: deletedAccount.id },
              { ready: true, seat: 2, userId: peer.id },
            ],
          },
          status: 'started',
          tenderId,
        },
      })
    }
    const runtime = {
      env: { JWT_SECRET: 'test-account-lifecycle-secret-0001' },
      prisma,
    } as unknown as BackendRuntime

    await reconcileDeletedAccount({
      db: prisma,
      lifecycleSecret: runtime.env.JWT_SECRET,
      now,
    }, deletedAccount.id)

    expect(await prisma.user.findUniqueOrThrow({
      where: { id: deletedAccount.id },
      select: { deletionCleanupCompletedAt: true },
    })).toEqual({ deletionCleanupCompletedAt: null })
    const afterFirstPass = await prisma.tender.findMany({ select: { state: true } })
    expect(afterFirstPass.filter(({ state }) =>
      JSON.stringify(state).includes(deletedAccount.id))).toHaveLength(2)
    expect(await prisma.tenderRoom.count({
      where: {
        OR: [
          { hostId: deletedAccount.id },
          { members: { some: { userId: deletedAccount.id } } },
        ],
      },
    })).toBe(2)

    await runCronTask(
      'accounts:deletion-reconcile',
      runtime,
      new Date(now.getTime() + 60_000),
    )

    expect(await prisma.user.findUniqueOrThrow({
      where: { id: deletedAccount.id },
      select: { deletionCleanupCompletedAt: true },
    })).toEqual({ deletionCleanupCompletedAt: expect.any(Date) })
    expect((await prisma.tender.findMany({ select: { state: true } })).some(({ state }) =>
      JSON.stringify(state).includes(deletedAccount.id))).toBe(false)
    expect(await prisma.tenderRoom.count({
      where: {
        OR: [
          { hostId: deletedAccount.id },
          { members: { some: { userId: deletedAccount.id } } },
        ],
      },
    })).toBe(0)
  })

  test('assigns concurrent account-deletion claimers disjoint durable leases', async () => {
    const now = new Date('2026-09-04T17:00:00.000Z')
    const accounts = await Promise.all([0, 1].map((index) => prisma.user.create({
      data: {
        anonymizedAt: new Date(now.getTime() - 60_000 + index),
        deletionCleanupAvailableAt: now,
        login: `deleted-concurrent-claim-${index}`,
      },
    })))

    const [workerA, workerB] = await Promise.all([
      claimDeletedAccountCleanupBatch({
        db: prisma,
        limit: 1,
        now,
        workerId: 'account-cleanup-worker-a',
      }),
      claimDeletedAccountCleanupBatch({
        db: prisma,
        limit: 1,
        now,
        workerId: 'account-cleanup-worker-b',
      }),
    ])

    const claimedIds = [...workerA, ...workerB].map((claim) => claim.id)
    expect(claimedIds).toHaveLength(2)
    expect(new Set(claimedIds)).toEqual(new Set(accounts.map((account) => account.id)))
    expect(await prisma.user.findMany({
      where: { id: { in: claimedIds } },
      orderBy: { deletionCleanupClaimOwner: 'asc' },
      select: {
        deletionCleanupClaimOwner: true,
        deletionCleanupLeaseExpiresAt: true,
      },
    })).toEqual([
      {
        deletionCleanupClaimOwner: 'account-cleanup-worker-a',
        deletionCleanupLeaseExpiresAt: new Date(now.getTime() + accountDeletionClaimLeaseMs),
      },
      {
        deletionCleanupClaimOwner: 'account-cleanup-worker-b',
        deletionCleanupLeaseExpiresAt: new Date(now.getTime() + accountDeletionClaimLeaseMs),
      },
    ])
  })

  test('recovers an account-deletion claim after its worker lease expires', async () => {
    const now = new Date('2026-09-04T17:30:00.000Z')
    const account = await prisma.user.create({
      data: {
        anonymizedAt: new Date(now.getTime() - 60_000),
        deletionCleanupAttemptCount: 2,
        deletionCleanupAvailableAt: new Date(now.getTime() - 30_000),
        deletionCleanupClaimOwner: 'crashed-account-cleanup-worker',
        deletionCleanupLastFailureCode: 'database_conflict',
        deletionCleanupLeaseExpiresAt: new Date(now.getTime() - 1),
        login: 'deleted-expired-cleanup-claim',
      },
    })

    await expect(claimDeletedAccountCleanupBatch({
      db: prisma,
      limit: 1,
      now,
      workerId: 'replacement-account-cleanup-worker',
    })).resolves.toEqual([{
      failureAttemptCount: 2,
      id: account.id,
    }])
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: account.id },
      select: {
        deletionCleanupAttemptCount: true,
        deletionCleanupClaimOwner: true,
        deletionCleanupLastFailureCode: true,
        deletionCleanupLeaseExpiresAt: true,
      },
    })).toEqual({
      deletionCleanupAttemptCount: 2,
      deletionCleanupClaimOwner: 'replacement-account-cleanup-worker',
      deletionCleanupLastFailureCode: 'database_conflict',
      deletionCleanupLeaseExpiresAt: new Date(now.getTime() + accountDeletionClaimLeaseMs),
    })
  })

  test('uses the partial claim index when active accounts outnumber due tombstones', async () => {
    const now = new Date('2026-09-04T17:45:00.000Z')
    let testFailure: unknown

    try {
      await prisma.user.createMany({
        data: Array.from({ length: 20_000 }, (_, index) => ({
          deletionCleanupAvailableAt: now,
          login: `claim-index-active-${index}`,
        })),
      })
      const unleasedAccount = await prisma.user.create({
        data: {
          anonymizedAt: new Date(now.getTime() - 120_000),
          deletionCleanupAvailableAt: new Date(now.getTime() - 60_000),
          login: 'claim-index-due-unleased',
        },
      })
      const expiredLeaseAccount = await prisma.user.create({
        data: {
          anonymizedAt: new Date(now.getTime() - 90_000),
          deletionCleanupAvailableAt: new Date(now.getTime() - 30_000),
          deletionCleanupClaimOwner: 'expired-index-worker',
          deletionCleanupLeaseExpiresAt: new Date(now.getTime() - 1),
          login: 'claim-index-due-expired-lease',
        },
      })
      const claimableAccounts = [unleasedAccount, expiredLeaseAccount]
      await prisma.user.createMany({
        data: [
          {
            anonymizedAt: new Date(now.getTime() - 180_000),
            deletionCleanupAvailableAt: new Date(now.getTime() + 60_000),
            login: 'claim-index-future-backoff',
          },
          {
            anonymizedAt: new Date(now.getTime() - 150_000),
            deletionCleanupAvailableAt: new Date(now.getTime() - 60_000),
            deletionCleanupClaimOwner: 'live-index-worker',
            deletionCleanupLeaseExpiresAt: new Date(now.getTime() + 60_000),
            login: 'claim-index-live-lease',
          },
        ],
      })
      await prisma.$executeRaw`ANALYZE "users"`

      const plan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN (COSTS OFF)
        SELECT "id"
        FROM "users"
        WHERE "anonymized_at" IS NOT NULL
          AND "deletion_cleanup_completed_at" IS NULL
          AND "deletion_cleanup_available_at" <= ${now}
          AND (
            "deletion_cleanup_lease_expires_at" IS NULL
            OR "deletion_cleanup_lease_expires_at" <= ${now}
          )
        ORDER BY "deletion_cleanup_available_at" ASC, "anonymized_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 25
      `
      const planText = plan.map((row) => row['QUERY PLAN']).join('\n')
      expect(planText).toContain('users_deletion_cleanup_claim_idx')
      expect(planText).not.toContain('Sort')
      const [partialIndex] = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'users_deletion_cleanup_claim_idx'
      `
      expect(partialIndex?.indexdef).toContain(
        'WHERE ((anonymized_at IS NOT NULL) AND (deletion_cleanup_completed_at IS NULL))',
      )

      const claimed = await claimDeletedAccountCleanupBatch({
        db: prisma,
        limit: 25,
        now,
        workerId: 'claim-index-test-worker',
      })
      expect(new Set(claimed.map((claim) => claim.id))).toEqual(
        new Set(claimableAccounts.map((account) => account.id)),
      )
    } catch (error) {
      testFailure = error
      throw error
    } finally {
      try {
        await prisma.user.deleteMany({
          where: { login: { startsWith: 'claim-index-' } },
        })
        expect(await prisma.user.count({
          where: { login: { startsWith: 'claim-index-' } },
        })).toBe(0)
      } catch (cleanupError) {
        if (!testFailure) throw cleanupError
      }
    }
  }, 30_000)

  test('backs off more than 25 poisoned tombstones so a newer account is not starved', async () => {
    const now = new Date('2026-09-04T18:00:00.000Z')
    const poisonedAccounts = []
    for (let index = 0; index < 25; index += 1) {
      poisonedAccounts.push(await prisma.user.create({
        data: {
          anonymizedAt: new Date(now.getTime() - 120_000 + index),
          deletionCleanupAvailableAt: now,
          login: `deleted-poisoned-cleanup-${index}`,
        },
      }))
    }
    const healthyAccount = await prisma.user.create({
      data: {
        anonymizedAt: new Date(now.getTime() - 60_000),
        deletionCleanupAvailableAt: now,
        login: 'deleted-cleanup-after-poison-prefix',
      },
    })
    await prisma.tender.createMany({
      data: poisonedAccounts.map((account) => ({
        phase: 'contract',
        state: { players: [{ id: account.id, tiePriority: 1 }] },
        version: 0,
      })),
    })

    await expect(reconcileDeletedAccounts({
      db: prisma,
      lifecycleSecret: 'test-account-lifecycle-secret-0001',
      now,
    })).resolves.toMatchObject({
      accounts: 0,
      deferredFailed: 25,
      deferredFailures: { legacy_data_invalid: 25 },
      failed: 25,
      failures: { legacy_data_invalid: 25 },
      pending: 26,
    })
    expect(await prisma.user.count({
      where: {
        deletionCleanupAttemptCount: 1,
        deletionCleanupAvailableAt: { gt: now },
        deletionCleanupClaimOwner: null,
        deletionCleanupLastFailureCode: 'legacy_data_invalid',
        id: { in: poisonedAccounts.map((account) => account.id) },
      },
    })).toBe(25)

    await expect(reconcileDeletedAccounts({
      db: prisma,
      lifecycleSecret: 'test-account-lifecycle-secret-0001',
      now,
    })).resolves.toMatchObject({
      accounts: 1,
      deferredFailed: 25,
      deferredFailures: { legacy_data_invalid: 25 },
      failed: 0,
      pending: 25,
    })
    expect(await prisma.user.findUniqueOrThrow({
      where: { id: healthyAccount.id },
      select: { deletionCleanupCompletedAt: true },
    })).toEqual({ deletionCleanupCompletedAt: expect.any(Date) })
  }, 60_000)

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
