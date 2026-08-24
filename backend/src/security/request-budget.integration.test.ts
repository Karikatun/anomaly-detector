import { createHash, createHmac } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../db'
import {
  createRequestBudgetPolicyCatalog,
  requestBudgetPolicyEntries,
} from './request-budget-policy'
import { createPrismaRequestBudget } from './request-budget'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const secret = 'request-budget-test-secret-at-least-32-bytes'

describe('request budget policy catalog', () => {
  test('keeps generic scopes allowlisted, classifies admin aggregation, and applies validated overrides', () => {
    const catalog = createRequestBudgetPolicyCatalog({
      ANTI_ABUSE_ROOM_JOIN_LIMIT: 7,
      ANTI_ABUSE_TENDER_COMMAND_LIMIT: 11,
    })

    expect(catalog.room_join).toEqual({
      adminAggregation: 'authenticated_only',
      limit: 7,
      scope: 'room_join',
      surface: 'room_join',
      windowMs: 60_000,
    })
    expect(catalog.tender_command.limit).toBe(11)
    expect(catalog.authenticated_mutation.limit).toBe(120)
    expect(requestBudgetPolicyEntries(catalog)
      .filter(({ adminAggregation }) => adminAggregation === 'excluded')
      .map(({ scope }) => scope)).toEqual([
      'login_failure',
      'login_ip_attempt',
      'registration_device',
      'registration_ip',
      'password_reset_login_hour',
      'password_reset_login_day',
      'password_reset_ip_hour',
      'password_reset_ip_day',
      'rec_code_login_hour',
      'rec_code_login_day',
      'rec_code_ip_hour',
      'rec_code_ip_day',
    ])
    expect(requestBudgetPolicyEntries(catalog)
      .filter(({ adminAggregation }) => adminAggregation === 'authenticated_only')
      .map(({ scope }) => scope)).toEqual([
      'rec_email_account_min',
      'rec_email_account_hour',
      'rec_email_account_day',
      'rec_email_address_min',
      'rec_email_address_hour',
      'rec_email_address_day',
      'rec_email_ip_hour',
      'authenticated_mutation',
      'room_join',
      'tender_command',
      'realtime_ticket_issue',
    ])
    expect(requestBudgetPolicyEntries(catalog).map(({ scope }) => scope)).toEqual(expect.arrayContaining([
      'authenticated_mutation',
      'realtime_ticket_issue',
      'room_join',
      'tender_command',
    ]))
    expect(() => createRequestBudgetPolicyCatalog({
      ANTI_ABUSE_ROOM_JOIN_LIMIT: 0,
    })).toThrow('ANTI_ABUSE_ROOM_JOIN_LIMIT')
    for (const key of [
      'ANTI_ABUSE_RECOVERY_EMAIL_HOUR_LIMIT',
      'ANTI_ABUSE_RECOVERY_EMAIL_DAY_LIMIT',
      'ANTI_ABUSE_RECOVERY_EMAIL_IP_HOUR_LIMIT',
    ] as const) {
      expect(() => createRequestBudgetPolicyCatalog({ [key]: 1 })).toThrow(key)
      expect(() => createRequestBudgetPolicyCatalog({ [key]: 2 })).not.toThrow()
    }
  })
})

maybeDescribe('Prisma request budget', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const catalog = createRequestBudgetPolicyCatalog({ ANTI_ABUSE_ROOM_JOIN_LIMIT: 2 })
  const budget = createPrismaRequestBudget(prisma, secret)
  const identity = 'raw-player-identity@example.test'
  const now = new Date('2026-08-24T10:00:00.000Z')

  beforeEach(async () => {
    await prisma.authAbuseBucket.deleteMany({
      where: { scope: { in: ['room_join', 'tender_command'] } },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('persists domain-separated HMAC keys, caps exhausted counts, and resets expired windows', async () => {
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => budget.consume({
      key: identity,
      now,
      policy: catalog.room_join,
    })))

    expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(2)
    expect(outcomes.filter(({ allowed }) => !allowed)).toHaveLength(6)

    await budget.consume({
      key: identity,
      now,
      policy: catalog.tender_command,
    })

    const buckets = await prisma.authAbuseBucket.findMany({
      where: { scope: { in: ['room_join', 'tender_command'] } },
      orderBy: { scope: 'asc' },
    })
    const roomBucket = buckets.find(({ scope }) => scope === 'room_join')
    const tenderBucket = buckets.find(({ scope }) => scope === 'tender_command')
    const roomKeyHash = createHmac('sha256', secret)
      .update('request-budget-v1\0')
      .update('room_join')
      .update('\0')
      .update(identity)
      .digest('hex')
    const plainDigest = createHash('sha256')
      .update(`request-budget:room_join:${identity}`)
      .digest('hex')

    expect(roomBucket).toMatchObject({ count: 3, keyHash: roomKeyHash })
    expect(roomBucket?.keyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(roomBucket?.keyHash).not.toBe(plainDigest)
    expect(tenderBucket?.keyHash).not.toBe(roomBucket?.keyHash)
    expect(JSON.stringify(buckets)).not.toContain(identity)

    const afterExpiry = new Date(now.getTime() + catalog.room_join.windowMs)
    expect(await budget.consume({
      key: identity,
      now: afterExpiry,
      policy: catalog.room_join,
    })).toEqual({ allowed: true, retryAfterSeconds: 60 })
    expect(await prisma.authAbuseBucket.findUniqueOrThrow({
      where: { scope_keyHash: { keyHash: roomKeyHash, scope: 'room_join' } },
    })).toMatchObject({ count: 1, windowStartedAt: afterExpiry })
  })
})
