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

  test('deletes expired and revoked auth sessions after the retention window', async () => {
    const calls: unknown[] = []
    const abuseCalls: unknown[] = []
    const oauthCalls: unknown[] = []
    const realtimeCalls: unknown[] = []
    const cleanupRuntime = {
      env: { SESSION_ABSOLUTE_TTL_DAYS: 90, SESSION_RETENTION_DAYS: 7 },
      prisma: {
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
      },
    } as unknown as BackendRuntime

    const now = new Date('2026-04-08T12:00:00.000Z')
    await runCronTask('auth:sessions:cleanup', cleanupRuntime, now)

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
    expect(calls[0]).toMatchObject({
      where: {
        OR: [
          { expiresAt: { lt: expect.any(Date) } },
          { revokedAt: { lt: expect.any(Date) } },
          { createdAt: { lt: new Date('2026-01-01T12:00:00.000Z') } },
        ],
      },
    })
  })
})
