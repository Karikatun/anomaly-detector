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
  roomsByStatus: { waiting: 1, starting: 0, started: 0 },
  tendersByPhase: [{ phase: 'reconnaissance', count: 1 }],
  users: { page: 1, pageSize: 20, totalItems: 3, totalPages: 1, items: [] },
}

test('conceals the admin route from anonymous and ordinary users', async () => {
  const module = createAdminModule({
    adminUserIds: new Set([admin.id]),
    authenticate: async (token) => {
      if (token === 'admin-token') return admin
      if (token === 'player-token') return { ...admin, id: '019f8099-7e26-7760-ad08-66d1d66b2720' }
      throw new Error('invalid token')
    },
    overviewReader: { read: async () => overview },
  })

  for (const authorization of [undefined, 'Bearer player-token']) {
    const response = await module.routes.request('/overview', {
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
    overviewReader: { read: async () => overview },
  })

  const response = await module.routes.request('/overview', {
    headers: { Authorization: 'Bearer admin-token' },
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(overview)
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
    overviewReader: {
      read: async (query) => {
        receivedQuery = query
        return secondPage
      },
    },
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
    overviewReader: { read: async () => { throw new Error('database unavailable') } },
  })
  module.routes.onError((_error, c) => c.json({ error: 'internal' }, 500))

  const response = await module.routes.request('/overview', {
    headers: { Authorization: 'Bearer admin-token' },
  })

  expect(response.status).toBe(500)
})
