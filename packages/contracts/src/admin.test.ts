import { describe, expect, test } from 'bun:test'

import {
  adminOverviewQuerySchema,
  adminOverviewSchema,
  mailPolicySyncCommandSchema,
  mailPolicyStatusCommandSchema,
  mailOperationsViewSchema,
  mailPolicyViewSchema,
  requestBudgetOverviewSchema,
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
  test('accepts a bounded reviewed provider catalog without registry candidates', () => {
    const result = mailPolicyViewSchema.parse({
      availableCatalog: {
        diff: {
          addedProviderIds: ['reg_ru'],
          changedProviderIds: [],
          removedProviderIds: [],
        },
        providers: [{
          customDomain: {
            allowedZones: ['ru', 'xn--p1ai'],
            mxExchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'],
          },
          displayName: 'REG.RU',
          evidenceUrl: 'https://help.reg.ru/support/hosting/example',
          providerId: 'reg_ru',
          publicDomains: [],
        }],
        version: 1,
      },
      currentVersion: 0,
      generatedAt: '2026-08-22T10:00:00.000Z',
      publishedPolicy: null,
    })

    expect(result.availableCatalog.providers).toHaveLength(1)
    expect(JSON.stringify(result)).not.toMatch(/registry|candidate|distributor/i)
    expect(() => mailPolicyViewSchema.parse({
      ...result,
      latestAttempt: null,
    })).toThrow()
    expect(() => mailPolicyViewSchema.parse({
      ...result,
      availableCatalog: {
        ...result.availableCatalog,
        providers: [{
          ...result.availableCatalog.providers[0],
          customDomain: {
            allowedZones: ['ru'],
            mxExchanges: Array.from({ length: 9 }, (_, index) => `mx${index}.example.ru`),
          },
        }],
      },
    })).toThrow()
  })

  test('bounds provider catalog sync and status commands', () => {
    const commandId = '019f8099-7e26-7760-ad08-66d1d66b2720'
    expect(mailPolicySyncCommandSchema.parse({ commandId, expectedVersion: 0 })).toEqual({
      commandId,
      expectedVersion: 0,
    })
    expect(mailPolicyStatusCommandSchema.parse({
      commandId,
      expectedVersion: 1,
      providerId: 'yandex',
      reason: 'Подтверждённый security-инцидент',
      state: 'blocked',
    }).state).toBe('blocked')

    expect(() => mailPolicyStatusCommandSchema.parse({
      commandId,
      expectedVersion: 1,
      providerId: 'yandex',
      reason: 'Вернуть разрешение',
      state: 'approved',
    })).toThrow()
  })
})

describe('mailOperationsViewSchema', () => {
  test('keeps the mail overview strict without the separately versioned anti-abuse view', () => {
    const result = mailOperationsViewSchema.parse({
      currentVersion: 0,
      delivery: {
        budget: { limitPerMinute: 60, usedInWindow: 3, windowStartedAt: '2026-08-22T12:00:00.000Z' },
        circuit: { consecutiveFailures: 0, openUntil: null, state: 'closed' },
        configured: true,
        groups: [{
          requested: 12,
          providerId: 'yandex',
          smtpAccepted: 10,
          templateKind: 'account_email_confirmation',
          temporaryFailures: 2,
          terminalFailures: 0,
        }],
        lastSmtpSuccessAt: '2026-08-22T12:01:00.000Z',
        outbox: { leased: 1, oldestQueuedAt: '2026-08-22T11:59:00.000Z', queued: 2 },
        provider: 'reg_ru',
        catalogLastSyncedAt: '2026-08-22T10:00:00.000Z',
        totals: { requested: 12, smtpAccepted: 10, temporaryFailures: 2, terminalFailures: 0 },
      },
      generatedAt: '2026-08-22T12:02:00.000Z',
      availableCatalog: {
        diff: {
          addedProviderIds: [],
          changedProviderIds: [],
          removedProviderIds: [],
        },
        providers: [],
        version: 1,
      },
      publishedPolicy: null,
    })

    expect(result.delivery.totals.smtpAccepted).toBe(10)
    expect(JSON.stringify(result.delivery)).not.toMatch(/recipient|address|token|code|content/i)
    expect(() => mailOperationsViewSchema.parse({
      ...result,
      antiAbuse: {
        groups: [{ exhaustedBudgetKeysAtLeast: 10, surface: 'transactional_mail' }],
        minimumGroupSize: 10,
        roundingStep: 10,
      },
    })).toThrow()
    expect(() => mailOperationsViewSchema.parse({
      ...result,
      delivery: {
        ...result.delivery,
        groups: [{ ...result.delivery.groups[0], requested: 4 }],
      },
    })).toThrow()
  })
})

describe('requestBudgetOverviewSchema', () => {
  test('allows only rounded lower bounds for broad exhausted groups', () => {
    const overview = requestBudgetOverviewSchema.parse({
      groups: [
        { exhaustedBudgetKeysAtLeast: 10, surface: 'authentication' },
        { exhaustedBudgetKeysAtLeast: 20, surface: 'room_join' },
        { exhaustedBudgetKeysAtLeast: 30, surface: 'tender_command' },
        { exhaustedBudgetKeysAtLeast: 40, surface: 'realtime' },
      ],
      minimumGroupSize: 10,
      roundingStep: 10,
    })

    expect(overview.groups.map((group) => group.surface)).toEqual([
      'authentication',
      'room_join',
      'tender_command',
      'realtime',
    ])
    for (const exhaustedBudgetKeysAtLeast of [9, 11]) {
      expect(() => requestBudgetOverviewSchema.parse({
        groups: [{ exhaustedBudgetKeysAtLeast, surface: 'transactional_mail' }],
        minimumGroupSize: 10,
        roundingStep: 10,
      })).toThrow()
    }
    expect(() => requestBudgetOverviewSchema.parse({
      groups: [{
        activeBudgetKeys: 10,
        exhaustedBudgetKeysAtLeast: 10,
        email: 'person@example.invalid',
        exhaustedBudgetKeys: 0,
        ipAddress: '192.0.2.1',
        keyHash: 'a'.repeat(64),
        login: 'sensitive-login',
        requests: 10,
        scope: 'recovery_email_hour_login',
        surface: 'authentication',
        tenderId: '019f8099-7e26-7760-ad08-66d1d66b2722',
        userId: '019f8099-7e26-7760-ad08-66d1d66b2721',
      }],
      minimumGroupSize: 10,
      roundingStep: 10,
    })).toThrow()
    expect(() => requestBudgetOverviewSchema.parse({
      groups: [{
        exhaustedBudgetKeysAtLeast: 10,
        surface: 'authenticated_mutation',
      }],
      minimumGroupSize: 10,
      roundingStep: 10,
    })).toThrow()
    expect(() => requestBudgetOverviewSchema.parse({
      groups: [{ exhaustedBudgetKeysAtLeast: 10, surface: 'authentication' }],
      minimumGroupSize: 10,
      roundingStep: 5,
    })).toThrow()
  })
})
