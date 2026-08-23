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
    const feedbackCalls: unknown[] = []
    const analyticsJourneyCalls: unknown[] = []
    const analyticsAggregateCalls: unknown[] = []
    const cleanupRuntime = {
      env: {
        MAIL_OUTBOX_RETENTION_DAYS: 30,
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
      },
      prisma: {
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
          deleteMany: async (input: unknown) => {
            mailOutboxCalls.push(input)
            return { count: 7 }
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
    expect(roomCalls).toHaveLength(2)
    expect(feedbackCalls).toHaveLength(2)

    await expect(
      runCronTask('analytics:cleanup', cleanupRuntime, now),
    ).resolves.toBeUndefined()
    expect(analyticsJourneyCalls).toHaveLength(3)
    expect(analyticsAggregateCalls).toHaveLength(3)
  })
})
