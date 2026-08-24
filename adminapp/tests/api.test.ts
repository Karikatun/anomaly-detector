import { expect, test } from 'bun:test'

import { AdminApi, AdminApiError } from '../src/api'

const mailOperationsView = {
  currentVersion: 0,
  delivery: {
    budget: { limitPerMinute: 60, usedInWindow: 0, windowStartedAt: null },
    circuit: { consecutiveFailures: 0, openUntil: null, state: 'disabled' },
    configured: false,
    groups: [],
    lastSmtpSuccessAt: null,
    outbox: { leased: 0, oldestQueuedAt: null, queued: 0 },
    provider: 'reg_ru',
    registryLastSuccessfulImportAt: null,
    totals: { requested: 0, smtpAccepted: 0, temporaryFailures: 0, terminalFailures: 0 },
  },
  generatedAt: '2026-08-22T12:00:00.000Z',
  latestAttempt: null,
  lastSuccessfulImport: null,
  publishedPolicy: null,
}
const antiAbuseOverview = {
  groups: [{ exhaustedBudgetKeysAtLeast: 10, surface: 'authentication' }],
  minimumGroupSize: 10,
  roundingStep: 10,
}

test('restores the cookie session and reads the overview with its access token', async () => {
  const requests: Array<{ authorization: string | null; credentials: RequestCredentials | undefined; method: string; url: string }> = []
  const api = new AdminApi('https://api.example.com', async (input, init) => {
    const headers = new Headers(init?.headers)
    const url = String(input)
    requests.push({
      authorization: headers.get('authorization'),
      credentials: init?.credentials,
      method: init?.method ?? 'GET',
      url,
    })

    if (url.endsWith('/api/auth/refresh')) {
      return Response.json({ accessToken: 'access-token' })
    }
    return Response.json({
      generatedAt: '2026-08-03T12:00:00.000Z',
      totals: { users: 2, activeSessions: 1, rooms: 0, tenders: 0 },
      roomsByStatus: { waiting: 0, active: 0, completed: 0 },
      tendersByPhase: [],
      users: { page: 2, pageSize: 20, totalItems: 21, totalPages: 2, items: [] },
    })
  })

  await api.restoreSession()
  await expect(api.getOverview(2)).resolves.toMatchObject({ users: { page: 2 } })
  expect(requests).toEqual([
    {
      authorization: null,
      credentials: 'include',
      method: 'POST',
      url: 'https://api.example.com/api/auth/refresh',
    },
    {
      authorization: 'Bearer access-token',
      credentials: 'include',
      method: 'GET',
      url: 'https://api.example.com/api/operations/overview?page=2&pageSize=20',
    },
  ])
})

test('classifies a concealed overview as unavailable without exposing backend details', async () => {
  const api = new AdminApi('', async (input) => {
    if (String(input).endsWith('/api/auth/refresh')) {
      return Response.json({ accessToken: 'ordinary-user-token' })
    }
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'Route not found' } },
      { status: 404 },
    )
  })

  await api.restoreSession()
  await expect(api.getOverview()).rejects.toEqual(
    new AdminApiError(404, 'NOT_FOUND', 'Ресурс недоступен'),
  )
})

test('coalesces concurrent cookie-session restores into one refresh request', async () => {
  let refreshRequests = 0
  const api = new AdminApi('', async () => {
    refreshRequests += 1
    await Promise.resolve()
    return Response.json({ accessToken: 'access-token' })
  })

  await Promise.all([api.restoreSession(), api.restoreSession()])

  expect(refreshRequests).toBe(1)
})

test('invokes the default browser fetch with its global receiver', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = function () {
    expect(this).toBe(globalThis)
    return Promise.resolve(Response.json({ accessToken: 'access-token' }))
  } as typeof fetch

  try {
    await expect(new AdminApi().restoreSession()).resolves.toBeUndefined()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses the authenticated narrow mail-policy endpoints without generic mutations', async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const api = new AdminApi('', async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/auth/refresh')) return Response.json({ accessToken: 'operator-token' })
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? 'GET',
      url,
    })
    if (url.endsWith('/api/operations/mail-policy/anti-abuse')) {
      return Response.json(antiAbuseOverview)
    }
    return Response.json(mailOperationsView)
  })
  const commandId = '019f8099-7e26-7760-ad08-66d1d66b2750'

  await api.restoreSession()
  await expect(api.getMailPolicyWorkspace()).resolves.toEqual({
    antiAbuse: antiAbuseOverview,
    mailPolicy: mailOperationsView,
  })
  await expect(api.importMailPolicy({ commandId, expectedVersion: 0 })).resolves.toEqual(mailOperationsView)
  await expect(api.publishMailPolicy({
    additions: [{
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      emailDomain: 'yandex.ru',
      sourceCandidateId: '019f8099-7e26-7760-ad08-66d1d66b2751',
    }],
    commandId,
    expectedVersion: 0,
  })).resolves.toEqual(mailOperationsView)
  await expect(api.changeMailPolicyStatus({
    commandId,
    emailDomain: 'yandex.ru',
    expectedVersion: 1,
    reason: 'Security-инцидент',
    state: 'blocked',
  })).resolves.toEqual(mailOperationsView)

  expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'GET', url: '/api/operations/mail-policy' },
    { method: 'GET', url: '/api/operations/mail-policy/anti-abuse' },
    { method: 'POST', url: '/api/operations/mail-policy/import' },
    { method: 'POST', url: '/api/operations/mail-policy/publish' },
    { method: 'POST', url: '/api/operations/mail-policy/status' },
  ])
  expect(requests[2].body).toEqual({ commandId, expectedVersion: 0 })
  expect(requests.some(({ url }) => /create|update|delete/.test(url))).toBe(false)
})

test('keeps the mail screen available only for a missing rollback-era anti-abuse endpoint', async () => {
  const urls: string[] = []
  const api = new AdminApi('', async (input) => {
    const url = String(input)
    if (url.endsWith('/api/auth/refresh')) return Response.json({ accessToken: 'operator-token' })
    urls.push(url)
    if (url.endsWith('/api/operations/mail-policy')) return Response.json(mailOperationsView)
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, { status: 404 })
  })

  await api.restoreSession()
  await expect(api.getMailPolicyWorkspace()).resolves.toEqual({
    antiAbuse: null,
    mailPolicy: mailOperationsView,
  })
  expect(urls).toEqual([
    '/api/operations/mail-policy',
    '/api/operations/mail-policy/anti-abuse',
  ])

  const failingApi = new AdminApi('', async (input) => {
    if (String(input).endsWith('/api/operations/mail-policy')) {
      return Response.json(mailOperationsView)
    }
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'failed' } }, { status: 500 })
  })
  await expect(failingApi.getMailPolicyWorkspace()).rejects.toEqual(
    new AdminApiError(500, 'INTERNAL_ERROR', 'failed'),
  )
})

test('does not probe anti-abuse after the concealed legacy mail endpoint', async () => {
  const urls: string[] = []
  const api = new AdminApi('', async (input) => {
    const url = String(input)
    urls.push(url)
    return Response.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, { status: 404 })
  })

  await expect(api.getMailPolicyWorkspace()).rejects.toEqual(
    new AdminApiError(404, 'NOT_FOUND', 'Ресурс недоступен'),
  )
  expect(urls).toEqual(['/api/operations/mail-policy'])
})

test('uses only the explicit authenticated feedback queue commands', async () => {
  const requests: Array<{ authorization: string | null; body: unknown; method: string; url: string }> = []
  const reportId = '019f8099-7e26-7760-ad08-66d1d66b2718'
  const commandId = '019f8099-7e26-7760-ad08-66d1d66b2720'
  const api = new AdminApi('', async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/auth/refresh')) return Response.json({ accessToken: 'operator-token' })
    requests.push({
      authorization: new Headers(init?.headers).get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? 'GET',
      url,
    })
    if ((init?.method ?? 'GET') === 'GET') {
      return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 })
    }
    return Response.json({ commandId, reportId, version: 2 })
  })

  await api.restoreSession()
  await api.getFeedbackQueue({ page: 1, pageSize: 20, status: 'new' })
  await api.takeFeedback(reportId, { commandId, expectedVersion: 1 })
  await api.resolveFeedback(reportId, { commandId, expectedVersion: 1 })
  await api.rejectFeedback(reportId, {
    commandId,
    expectedVersion: 1,
    reason: 'Недостаточно сведений.',
  })
  await api.recordFeedbackGithubIssue(reportId, {
    commandId,
    expectedVersion: 1,
    githubIssueNumber: 41,
  })
  await api.deleteFeedbackContact(reportId, { commandId, expectedVersion: 1 })

  expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'GET', url: '/api/operations/feedback?page=1&pageSize=20&status=new' },
    { method: 'POST', url: `/api/operations/feedback/${reportId}/take` },
    { method: 'POST', url: `/api/operations/feedback/${reportId}/resolve` },
    { method: 'POST', url: `/api/operations/feedback/${reportId}/reject` },
    { method: 'POST', url: `/api/operations/feedback/${reportId}/github-issue` },
    { method: 'POST', url: `/api/operations/feedback/${reportId}/contact/delete` },
  ])
  expect(requests.every((request) => request.authorization === 'Bearer operator-token')).toBe(true)
  expect(requests[3].body).toEqual({
    commandId,
    expectedVersion: 1,
    reason: 'Недостаточно сведений.',
  })
  expect(requests[4].body).toEqual({
    commandId,
    expectedVersion: 1,
    githubIssueNumber: 41,
  })
})

test('reads only a bounded aggregate analytics window', async () => {
  const requests: Array<{ authorization: string | null; method: string; url: string }> = []
  const api = new AdminApi('', async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/auth/refresh')) return Response.json({ accessToken: 'operator-token' })
    requests.push({
      authorization: new Headers(init?.headers).get('authorization'),
      method: init?.method ?? 'GET',
      url,
    })
    return Response.json({
      botLandingViews: 2,
      daily: [],
      generatedAt: '2026-08-23T12:00:00.000Z',
      sources: [{ category: 'direct', landingViews: 10 }],
      steps: [{ count: 10, event: 'landing_view' }],
      transitions: [],
      windowDays: 30,
    })
  })

  await api.restoreSession()
  const result = await api.getAnalytics(30)

  expect(result.windowDays).toBe(30)
  expect(requests).toEqual([{
    authorization: 'Bearer operator-token',
    method: 'GET',
    url: '/api/operations/analytics?windowDays=30',
  }])
  expect(JSON.stringify(result)).not.toMatch(/"(?:accountId|cookie|email|ipAddress|journeyId|login|rawEvents|userId)"/i)
})
