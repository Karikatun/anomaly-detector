import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { runCronTask } from './cron'

const runtime = {} as BackendRuntime

describe('runCronTask', () => {
  test('runs the noop task', async () => {
    await expect(runCronTask('noop', runtime)).resolves.toBeUndefined()
  })

  test('rejects unknown tasks', async () => {
    await expect(runCronTask('missing', runtime)).rejects.toThrow('Unknown cron task')
  })

  test('deletes expired auth data, feedback and waiting rooms', async () => {
    const calls: unknown[] = []
    const abuseCalls: unknown[] = []
    const oauthCalls: unknown[] = []
    const realtimeCalls: unknown[] = []
    const roomCalls: unknown[] = []
    const mailOutboxCalls: unknown[] = []
    const pendingMailCalls: unknown[] = []
    const mailAttemptCalls: unknown[] = []
    const feedbackCalls: unknown[] = []
    const analyticsJourneyCalls: unknown[] = []
    const analyticsAggregateCalls: unknown[] = []
    const recoveryEmailChallengeCalls: unknown[] = []
    const recoveryEmailReplacementCalls: unknown[] = []
    const recoveryEmailReplacementUpdateCalls: unknown[] = []
    const recoveryCodeReissueCalls: unknown[] = []
    const recoveryCodeEmailReplacementCalls: unknown[] = []
    const passwordResetCredentialCalls: unknown[] = []
    const mailDomainAssessmentFindCalls: unknown[] = []
    const mailDomainAssessmentDeleteCalls: unknown[] = []
    let transactionAttempts = 0
    const prismaModels = {
      recoveryEmailChallenge: {
        deleteMany: async (input: unknown) => {
          recoveryEmailChallengeCalls.push(input)
          return { count: 11 }
        },
      },
      recoveryEmailReplacement: {
        updateMany: async (input: unknown) => {
          recoveryEmailReplacementUpdateCalls.push(input)
          return { count: 1 }
        },
        deleteMany: async (input: unknown) => {
          recoveryEmailReplacementCalls.push(input)
          return { count: 12 }
        },
      },
      recoveryCodeReissueChallenge: {
        deleteMany: async (input: unknown) => {
          recoveryCodeReissueCalls.push(input)
          return { count: 13 }
        },
      },
      recoveryCodeEmailReplacement: {
        deleteMany: async (input: unknown) => {
          recoveryCodeEmailReplacementCalls.push(input)
          return { count: 14 }
        },
      },
      passwordResetCredential: {
        deleteMany: async (input: unknown) => {
          passwordResetCredentialCalls.push(input)
          return { count: 15 }
        },
      },
      mailDeliveryAttempt: {
        createMany: async (input: unknown) => {
          mailAttemptCalls.push(input)
          return { count: 2 }
        },
      },
      mailOutboxMessage: {
        updateManyAndReturn: async (input: unknown) => {
          pendingMailCalls.push(input)
          return [{ id: 'mail-1' }, { id: 'mail-2' }]
        },
      },
    }
    const cleanupRuntime = {
      env: {
        MAIL_OUTBOX_RETENTION_DAYS: 30,
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
      },
      prisma: {
        ...prismaModels,
        $transaction: async (
          operation: (tx: typeof prismaModels) => Promise<unknown>,
        ) => {
          transactionAttempts += 1
          if (transactionAttempts === 1) throw { code: 'P2034' }
          if (transactionAttempts === 2) {
            throw {
              cause: { code: '40P01', kind: 'postgres' },
              name: 'DriverAdapterError',
            }
          }
          return operation(prismaModels)
        },
        analyticsDailyAggregate: {
          deleteMany: async (input: unknown) => {
            analyticsAggregateCalls.push(input)
            return { count: 10 }
          },
        },
        analyticsJourney: {
          deleteMany: async (input: unknown) => {
            analyticsJourneyCalls.push(input)
            return { count: 9 }
          },
        },
        feedbackReport: {
          deleteMany: async (input: unknown) => {
            feedbackCalls.push(input)
            return { count: 8 }
          },
        },
        authAbuseBucket: {
          deleteMany: async (input: unknown) => {
            abuseCalls.push(input)
            return { count: 3 }
          },
        },
        authSession: {
          deleteMany: async (input: unknown) => {
            calls.push(input)
            return { count: 2 }
          },
        },
        oAuthTransaction: {
          deleteMany: async (input: unknown) => {
            oauthCalls.push(input)
            return { count: 4 }
          },
        },
        realtimeTicket: {
          deleteMany: async (input: unknown) => {
            realtimeCalls.push(input)
            return { count: 5 }
          },
        },
        mailOutboxMessage: {
          ...prismaModels.mailOutboxMessage,
          deleteMany: async (input: unknown) => {
            mailOutboxCalls.push(input)
            return { count: 7 }
          },
        },
        mailDomainAssessment: {
          findMany: async (input: unknown) => {
            mailDomainAssessmentFindCalls.push(input)
            return [{ emailDomain: 'expired-private-domain.ru' }]
          },
          deleteMany: async (input: unknown) => {
            mailDomainAssessmentDeleteCalls.push(input)
            return { count: 1 }
          },
        },
        tenderRoom: {
          deleteMany: async (input: unknown) => {
            roomCalls.push(input)
            return { count: 6 }
          },
        },
      },
    } as unknown as BackendRuntime

    const now = new Date('2026-04-08T12:00:00.000Z')
    await runCronTask('maintenance:cleanup', cleanupRuntime, now)

    expect(transactionAttempts).toBe(3)
    expect(calls).toHaveLength(1)
    expect(abuseCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
    expect(oauthCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
    expect(realtimeCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
    expect(roomCalls).toEqual([{
      where: {
        createdAt: { lt: new Date('2026-04-07T12:00:00.000Z') },
        status: 'waiting',
      },
    }])
    expect(mailOutboxCalls).toEqual([{
      where: {
        completedAt: { lt: new Date('2026-03-09T12:00:00.000Z') },
        state: { in: ['smtp_accepted', 'terminal_failure'] },
      },
    }])
    expect(pendingMailCalls).toEqual([{
      data: {
        completedAt: now,
        lastFailureCode: 'retention_expired',
        leaseExpiresAt: null,
        leaseOwner: null,
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      },
      select: { id: true },
      where: {
        OR: [
          {
            createdAt: { lte: new Date('2026-04-01T12:00:00.000Z') },
            templateKind: 'security_notification',
          },
          {
            templateKind: {
              in: ['account_email_confirmation', 'password_recovery'],
            },
            templatePayload: {
              lte: now.toISOString(),
              path: ['expiresAt'],
            },
          },
        ],
        state: { in: ['queued', 'leased'] },
      },
    }])
    expect(mailAttemptCalls).toEqual([{
      data: [
        {
          attemptedAt: now,
          failureCode: 'retention_expired',
          outcome: 'terminal_failure',
          outboxId: 'mail-1',
        },
        {
          attemptedAt: now,
          failureCode: 'retention_expired',
          outcome: 'terminal_failure',
          outboxId: 'mail-2',
        },
      ],
    }])
    expect(recoveryEmailChallengeCalls).toEqual([{
      where: { expiresAt: { lte: now } },
    }])
    expect(recoveryEmailReplacementCalls).toEqual([{
      where: {
        AND: [
          { newExpiresAt: { lte: now } },
          { oldExpiresAt: { lte: now } },
        ],
      },
    }])
    expect(recoveryEmailReplacementUpdateCalls).toEqual([
      {
        data: { oldCodeHash: '0'.repeat(64) },
        where: {
          oldCodeHash: { not: '0'.repeat(64) },
          oldExpiresAt: { lte: now },
        },
      },
      {
        data: { newCodeHash: '0'.repeat(64) },
        where: {
          newCodeHash: { not: '0'.repeat(64) },
          newExpiresAt: { lte: now },
        },
      },
    ])
    expect(recoveryCodeReissueCalls).toEqual([{
      where: { expiresAt: { lte: now } },
    }])
    expect(recoveryCodeEmailReplacementCalls).toEqual([{
      where: { newExpiresAt: { lte: now } },
    }])
    expect(passwordResetCredentialCalls).toEqual([{
      where: { expiresAt: { lte: now } },
    }])
    expect(mailDomainAssessmentFindCalls).toEqual([{
      orderBy: [
        { expiresAt: 'asc' },
        { emailDomain: 'asc' },
      ],
      select: { emailDomain: true },
      take: 500,
      where: { expiresAt: { lte: now } },
    }])
    expect(mailDomainAssessmentDeleteCalls).toEqual([{
      where: {
        emailDomain: { in: ['expired-private-domain.ru'] },
        expiresAt: { lte: now },
      },
    }])
    expect(feedbackCalls).toEqual([{
      where: {
        OR: [
          {
            createdAt: { lte: new Date('2025-10-10T12:00:00.000Z') },
            status: { in: ['new', 'in_review'] },
          },
          { resolvedAt: { lte: new Date('2026-03-09T12:00:00.000Z') } },
          { rejectedAt: { lte: new Date('2026-03-09T12:00:00.000Z') } },
          { transferredAt: { lte: new Date('2026-03-09T12:00:00.000Z') } },
        ],
      },
    }])
    expect(analyticsJourneyCalls).toEqual([{
      where: { expiresAt: { lte: now } },
    }])
    expect(analyticsAggregateCalls).toEqual([{
      where: { day: { lt: new Date('2025-03-08T00:00:00.000Z') } },
    }])
    expect(calls[0]).toMatchObject({
      where: {
        OR: [
          { expiresAt: { lt: expect.any(Date) } },
          { revokedAt: { lt: expect.any(Date) } },
          { createdAt: { lt: new Date('2026-01-01T12:00:00.000Z') } },
        ],
      },
    })

    await expect(
      runCronTask('auth:sessions:cleanup', cleanupRuntime, now),
    ).resolves.toBeUndefined()
    expect(transactionAttempts).toBe(4)
    expect(roomCalls).toHaveLength(2)
    expect(feedbackCalls).toHaveLength(2)

    await expect(
      runCronTask('analytics:cleanup', cleanupRuntime, now),
    ).resolves.toBeUndefined()
    expect(analyticsJourneyCalls).toHaveLength(3)
    expect(analyticsAggregateCalls).toHaveLength(3)
  })
})
