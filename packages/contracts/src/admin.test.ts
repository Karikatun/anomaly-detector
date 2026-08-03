import { describe, expect, test } from 'bun:test'

import { adminOverviewQuerySchema, adminOverviewSchema } from './admin'

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
