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
