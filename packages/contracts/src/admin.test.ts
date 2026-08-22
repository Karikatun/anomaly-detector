import { describe, expect, test } from 'bun:test'

import {
  adminOverviewQuerySchema,
  adminOverviewSchema,
  mailPolicyImportCommandSchema,
  mailPolicyPublishCommandSchema,
  mailPolicyStatusCommandSchema,
  mailOperationsViewSchema,
  mailPolicyViewSchema,
} from './admin'

describe('adminOverviewSchema', () => {
  test('accepts the read-only operational overview without sensitive auth fields', () => {
    const result = adminOverviewSchema.parse({
      generatedAt: '2026-08-03T12:00:00.000Z',
      totals: {
        users: 12,
        activeSessions: 4,
        rooms: 3,
        tenders: 2,
      },
      roomsByStatus: {
        waiting: 1,
        active: 1,
        completed: 1,
      },
      tendersByPhase: [{ phase: 'laboratory', count: 2 }],
      users: {
        page: 1,
        pageSize: 20,
        totalItems: 12,
        totalPages: 1,
        items: [{
          id: '019f8099-7e26-7760-ad08-66d1d66b2718',
          login: 'researcher',
          displayName: 'Исследователь',
          createdAt: '2026-08-03T11:00:00.000Z',
        }],
      },
    })

    expect(result.totals.activeSessions).toBe(4)
    expect(result.users.items[0]).not.toHaveProperty('passwordHash')
    expect(result.users.items[0]).not.toHaveProperty('ipAddress')
  })

  test('normalizes a bounded user-list page query', () => {
    expect(adminOverviewQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    })
    expect(() => adminOverviewQuerySchema.parse({ page: '0', pageSize: '101' })).toThrow()
  })
})

describe('mailPolicyViewSchema', () => {
  test('accepts a bounded candidate snapshot without registry personal data', () => {
    const result = mailPolicyViewSchema.parse({
      currentVersion: 0,
      generatedAt: '2026-08-22T10:00:00.000Z',
      latestAttempt: {
        checksum: 'a'.repeat(64),
        failureCode: null,
        finishedAt: '2026-08-22T09:59:00.000Z',
        id: '019f8099-7e26-7760-ad08-66d1d66b2718',
        outcome: 'succeeded',
        sourceDate: '2026-08-20',
        sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
      },
      lastSuccessfulImport: {
        candidates: [{
          evidence: 'service_description_mentions_mail',
          id: '019f8099-7e26-7760-ad08-66d1d66b2719',
          registryEntryId: '1-PP',
          serviceDomain: 'mail.yandex.ru',
        }],
        diff: {
          added: ['mail.yandex.ru'],
          removed: [],
          unchangedCount: 0,
        },
        importId: '019f8099-7e26-7760-ad08-66d1d66b2718',
      },
      publishedPolicy: null,
    })

    expect(result.lastSuccessfulImport?.candidates).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('distributorEmail')
    expect(JSON.stringify(result)).not.toContain('distributorName')
  })

  test('bounds the three explicit mutation commands and rejects generic states', () => {
    const commandId = '019f8099-7e26-7760-ad08-66d1d66b2720'
    expect(mailPolicyImportCommandSchema.parse({ commandId, expectedVersion: 0 })).toEqual({
      commandId,
      expectedVersion: 0,
    })
    expect(mailPolicyPublishCommandSchema.parse({
      additions: [{
        canonicalization: {
          ignoreDots: false,
          localPartCaseInsensitive: false,
          stripPlusTag: false,
        },
        emailDomain: 'yandex.ru',
        sourceCandidateId: '019f8099-7e26-7760-ad08-66d1d66b2719',
      }],
      commandId,
      expectedVersion: 0,
    }).additions).toHaveLength(1)
    expect(mailPolicyStatusCommandSchema.parse({
      commandId,
      emailDomain: 'yandex.ru',
      expectedVersion: 1,
      reason: 'Подтверждённый security-инцидент',
      state: 'blocked',
    }).state).toBe('blocked')

    expect(() => mailPolicyStatusCommandSchema.parse({
      commandId,
      emailDomain: 'yandex.ru',
      expectedVersion: 1,
      reason: 'Вернуть разрешение',
      state: 'approved',
    })).toThrow()
    expect(() => mailPolicyPublishCommandSchema.parse({
      additions: [],
      commandId,
      expectedVersion: 0,
    })).toThrow()
  })
})

describe('mailOperationsViewSchema', () => {
  test('accepts only privacy-safe delivery aggregates and suppresses small groups', () => {
    const result = mailOperationsViewSchema.parse({
      currentVersion: 0,
      delivery: {
        budget: { limitPerMinute: 60, usedInWindow: 3, windowStartedAt: '2026-08-22T12:00:00.000Z' },
        circuit: { consecutiveFailures: 0, openUntil: null, state: 'closed' },
        configured: true,
        groups: [{
          requested: 12,
          service: 'mail.yandex.ru',
          smtpAccepted: 10,
          templateKind: 'account_email_confirmation',
          temporaryFailures: 2,
          terminalFailures: 0,
        }],
        lastSmtpSuccessAt: '2026-08-22T12:01:00.000Z',
        outbox: { leased: 1, oldestQueuedAt: '2026-08-22T11:59:00.000Z', queued: 2 },
        provider: 'reg_ru',
        registryLastSuccessfulImportAt: '2026-08-22T10:00:00.000Z',
        totals: { requested: 12, smtpAccepted: 10, temporaryFailures: 2, terminalFailures: 0 },
      },
      generatedAt: '2026-08-22T12:02:00.000Z',
      latestAttempt: null,
      lastSuccessfulImport: null,
      publishedPolicy: null,
    })

    expect(result.delivery.totals.smtpAccepted).toBe(10)
    expect(JSON.stringify(result.delivery)).not.toMatch(/recipient|address|token|code|content/i)
    expect(() => mailOperationsViewSchema.parse({
      ...result,
      delivery: {
        ...result.delivery,
        groups: [{ ...result.delivery.groups[0], requested: 4 }],
      },
    })).toThrow()
  })
})
