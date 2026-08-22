import { expect, test } from 'bun:test'

import { AdminApi, AdminApiError } from '../src/api'

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
  const view = {
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
  const api = new AdminApi('', async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/auth/refresh')) return Response.json({ accessToken: 'operator-token' })
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? 'GET',
      url,
    })
    return Response.json(view)
  })
  const commandId = '019f8099-7e26-7760-ad08-66d1d66b2750'

  await api.restoreSession()
  await api.getMailPolicy()
  await api.importMailPolicy({ commandId, expectedVersion: 0 })
  await api.publishMailPolicy({
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
  })
  await api.changeMailPolicyStatus({
    commandId,
    emailDomain: 'yandex.ru',
    expectedVersion: 1,
    reason: 'Security-инцидент',
    state: 'blocked',
  })

  expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: 'GET', url: '/api/operations/mail-policy' },
    { method: 'POST', url: '/api/operations/mail-policy/import' },
    { method: 'POST', url: '/api/operations/mail-policy/publish' },
    { method: 'POST', url: '/api/operations/mail-policy/status' },
  ])
  expect(requests[1].body).toEqual({ commandId, expectedVersion: 0 })
  expect(requests.some(({ url }) => /create|update|delete/.test(url))).toBe(false)
})
