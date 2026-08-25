import { expect, test } from 'bun:test'

import type { AuthenticatedPrincipal } from '../auth'
import { createAdminModule } from './index'

const admin: AuthenticatedPrincipal = {
  authenticatedAt: new Date('2026-08-03T10:00:00.000Z'),
  createdAt: '2026-08-01T10:00:00.000Z',
  displayName: 'Operator',
  id: '019f8099-7e26-7760-ad08-66d1d66b2718',
  locale: 'ru',
  login: 'operator',
  sessionId: '019f8099-7e26-7760-ad08-66d1d66b2719',
}

const overview = {
  generatedAt: '2026-08-03T12:00:00.000Z',
  totals: { users: 3, activeSessions: 2, rooms: 1, tenders: 1 },
  roomsByStatus: { waiting: 1, active: 0, completed: 0 },
  tendersByPhase: [{ phase: 'reconnaissance', count: 1 }],
  users: { page: 1, pageSize: 20, totalItems: 3, totalPages: 1, items: [] },
}

const mailPolicyView = {
  availableCatalog: {
    diff: { addedProviderIds: [], changedProviderIds: [], removedProviderIds: [] },
    providers: [],
    version: 1,
  },
  currentVersion: 0,
  delivery: {
    budget: { limitPerMinute: 60, usedInWindow: 0, windowStartedAt: null },
    circuit: { consecutiveFailures: 0, openUntil: null, state: 'disabled' as const },
    configured: false,
    groups: [],
    lastSmtpSuccessAt: null,
    outbox: { leased: 0, oldestQueuedAt: null, queued: 0 },
    provider: 'reg_ru' as const,
    catalogLastSyncedAt: null,
    totals: { requested: 0, smtpAccepted: 0, temporaryFailures: 0, terminalFailures: 0 },
  },
  generatedAt: '2026-08-03T12:00:00.000Z',
  publishedPolicy: null,
}

const mailPolicy = {
  changeStatus: async () => mailPolicyView,
  read: async () => mailPolicyView,
  syncCatalog: async () => mailPolicyView,
}

const antiAbuse = {
  groups: [{
    exhaustedBudgetKeysAtLeast: 10,
    surface: 'authentication' as const,
  }],
  minimumGroupSize: 10 as const,
  roundingStep: 10 as const,
}

const requestBudgetOverviewReader = { read: async () => antiAbuse }

const feedbackQueue = {
  items: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 1,
}

const analyticsOverview = {
  botLandingViews: 2,
  daily: [{ count: 10, date: '2026-08-03', event: 'landing_view' as const }],
  generatedAt: '2026-08-03T12:00:00.000Z',
  sources: [{ category: 'direct' as const, landingViews: 10 }],
  steps: [{ count: 10, event: 'landing_view' as const }],
  transitions: [{
    conversionRate: 0.5,
    count: 5,
    from: 'landing_view' as const,
    to: 'tutorial_cta' as const,
  }],
  windowDays: 30 as const,
}

const feedback = {
  deleteContact: async () => ({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    reportId: '019f8099-7e26-7760-ad08-66d1d66b2721',
    version: 2,
  }),
  read: async () => feedbackQueue,
  recordGithubIssue: async () => ({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    reportId: '019f8099-7e26-7760-ad08-66d1d66b2721',
    version: 2,
  }),
  reject: async () => ({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    reportId: '019f8099-7e26-7760-ad08-66d1d66b2721',
    version: 2,
  }),
  resolve: async () => ({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    reportId: '019f8099-7e26-7760-ad08-66d1d66b2721',
    version: 2,
  }),
  take: async () => ({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    reportId: '019f8099-7e26-7760-ad08-66d1d66b2721',
    version: 2,
  }),
}

test('conceals the admin route from anonymous and ordinary users', async () => {
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async (token) => {
      if (token === 'admin-token') return admin
      if (token === 'player-token') return { ...admin, id: '019f8099-7e26-7760-ad08-66d1d66b2720' }
      throw new Error('invalid token')
    },
    feedback,
    mailPolicy,
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader,
  })

  for (const path of ['/overview', '/mail-policy', '/feedback']) {
    for (const authorization of [undefined, 'Bearer player-token']) {
      const response = await module.routes.request(path, {
        headers: authorization ? { Authorization: authorization } : undefined,
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Route not found' },
      })
    }
  }

  for (const authorization of [undefined, 'Bearer player-token']) {
    const response = await module.routes.request('/mail-policy/anti-abuse', {
      headers: authorization ? { Authorization: authorization } : undefined,
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    })
  }
})

test('returns a no-store overview to an allowlisted administrator', async () => {
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback,
    mailPolicy,
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader,
  })

  const response = await module.routes.request('/overview', {
    headers: { Authorization: 'Bearer admin-token' },
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(overview)
})

test('returns the privacy-safe request-budget projection only from its separate concealed endpoint', async () => {
  let receivedNow: unknown
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback,
    mailPolicy,
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader: {
      read: async (now) => {
        receivedNow = now
        return antiAbuse
      },
    },
  })

  const response = await module.routes.request('/mail-policy/anti-abuse', {
    headers: { Authorization: 'Bearer admin-token' },
  })
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(receivedNow).toBeInstanceOf(Date)
  expect(body).toEqual(antiAbuse)
  expect(JSON.stringify(body)).not.toMatch(/scope|keyHash|login|email|ip|userId|tenderId/i)
})

test('keeps the catalog mail endpoints exact and removes the legacy RKN mutations', async () => {
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback,
    mailPolicy,
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader,
  })
  const commandId = '019f8099-7e26-7760-ad08-66d1d66b2720'
  const requests = [
    module.routes.request('/mail-policy', {
      headers: { Authorization: 'Bearer admin-token' },
    }),
    module.routes.request('/mail-policy/sync', {
      body: JSON.stringify({ commandId, expectedVersion: 0 }),
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    module.routes.request('/mail-policy/status', {
      body: JSON.stringify({
        commandId,
        expectedVersion: 1,
        providerId: 'yandex',
        reason: 'Security-инцидент',
        state: 'blocked',
      }),
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  ]

  for (const response of await Promise.all(requests)) {
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(mailPolicyView)
  }
  for (const path of ['/mail-policy/import', '/mail-policy/publish']) {
    const response = await module.routes.request(path, {
      body: JSON.stringify({ commandId, expectedVersion: 0 }),
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(404)
  }
})

test('returns only a bounded aggregate analytics projection to an allowlisted administrator', async () => {
  let receivedQuery: unknown
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    analyticsReader: {
      read: async (query) => {
        receivedQuery = query
        return analyticsOverview
      },
    },
    authenticate: async () => admin,
    feedback,
    mailPolicy,
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader,
  })

  const response = await module.routes.request('/analytics?windowDays=30', {
    headers: { Authorization: 'Bearer admin-token' },
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(receivedQuery).toEqual({ windowDays: 30 })
  expect(await response.json()).toEqual(analyticsOverview)
  expect(JSON.stringify(await (await module.routes.request('/analytics?windowDays=30', {
    headers: { Authorization: 'Bearer admin-token' },
  })).json())).not.toMatch(/"(?:accountId|cookie|email|ipAddress|journeyId|login|rawEvents|userId)"/i)

  expect((await module.routes.request('/analytics?windowDays=31', {
    headers: { Authorization: 'Bearer admin-token' },
  })).status).toBe(500)
})

test('returns the requested page from the complete user list', async () => {
  let receivedQuery: unknown
  const secondPage = {
    ...overview,
    users: { page: 2, pageSize: 2, totalItems: 3, totalPages: 2, items: [] },
  }
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback,
    mailPolicy,
    overviewReader: {
      read: async (query) => {
        receivedQuery = query
        return secondPage
      },
    },
    requestBudgetOverviewReader,
  })

  const response = await module.routes.request('/overview?page=2&pageSize=2', {
    headers: { Authorization: 'Bearer admin-token' },
  })

  expect(response.status).toBe(200)
  expect(receivedQuery).toEqual({ page: 2, pageSize: 2 })
  expect(await response.json()).toEqual(secondPage)
})

test('does not conceal an overview read failure as an access denial', async () => {
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback,
    mailPolicy,
    overviewReader: { read: async () => { throw new Error('database unavailable') } },
    requestBudgetOverviewReader,
  })
  module.routes.onError((_error, c) => c.json({ error: 'internal' }, 500))

  const response = await module.routes.request('/overview', {
    headers: { Authorization: 'Bearer admin-token' },
  })

  expect(response.status).toBe(500)
})

test('passes a bounded catalog sync command and authenticated operator to the mail policy owner', async () => {
  let received: unknown
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback,
    mailPolicy: {
      ...mailPolicy,
      syncCatalog: async (command, operator) => {
        received = { command, operator }
        return mailPolicyView
      },
    },
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader,
  })

  const response = await module.routes.request('/mail-policy/sync', {
    body: JSON.stringify({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      expectedVersion: 0,
    }),
    headers: {
      Authorization: 'Bearer admin-token',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(received).toEqual({
    command: {
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      expectedVersion: 0,
    },
    operator: { authenticatedAt: admin.authenticatedAt, id: admin.id },
  })
  expect(await response.json()).toEqual(mailPolicyView)
})

test('passes bounded feedback queue queries and commands to the domain owner', async () => {
  let readQuery: unknown
  let commandInput: unknown
  const reportId = '019f8099-7e26-7760-ad08-66d1d66b2721'
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async () => admin,
    feedback: {
      ...feedback,
      read: async (query) => {
        readQuery = query
        return feedbackQueue
      },
      take: async (command, operator, receivedReportId) => {
        commandInput = { command, operator, reportId: receivedReportId }
        return {
          commandId: command.commandId,
          reportId: receivedReportId,
          version: 2,
        }
      },
    },
    mailPolicy,
    overviewReader: { read: async () => overview },
    requestBudgetOverviewReader,
  })

  const queueResponse = await module.routes.request('/feedback?page=2&pageSize=10&status=new', {
    headers: { Authorization: 'Bearer admin-token' },
  })
  expect(queueResponse.status).toBe(200)
  expect(readQuery).toEqual({ page: 2, pageSize: 10, status: 'new' })

  const command = {
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    expectedVersion: 1,
  }
  const commandResponse = await module.routes.request(`/feedback/${reportId}/take`, {
    body: JSON.stringify(command),
    headers: {
      Authorization: 'Bearer admin-token',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  expect(commandResponse.status).toBe(200)
  expect(commandInput).toEqual({
    command,
    operator: { authenticatedAt: admin.authenticatedAt, id: admin.id },
    reportId,
  })
  expect(await commandResponse.json()).toEqual({
    commandId: command.commandId,
    reportId,
    version: 2,
  })
})
