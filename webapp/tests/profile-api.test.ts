import { expect, test } from 'bun:test'

import { ProfileApi } from '../src/features/profile/api'
import type { AuthenticatedTransport } from '../src/platform/api'

test('profile API reads and validates authenticated statistics', async () => {
  const requests: string[] = []
  const api = new ProfileApi({
    request: async (path, schema) => {
      requests.push(path)
      return schema.parse({
        averagePlacement: null,
        averageRating: null,
        contractSuccessRate: null,
        matchesPlayed: 0,
        modelAccuracy: null,
        wins: 0,
        winRate: null,
      })
    },
  } as AuthenticatedTransport)

  await expect(api.getStatistics()).resolves.toMatchObject({ matchesPlayed: 0 })
  expect(requests).toEqual(['/api/profile/statistics'])
})

test('profile API accepts only a masked Account Email protection response', async () => {
  const requests: string[] = []
  const api = new ProfileApi({
    request: async (path, schema) => {
      requests.push(path)
      return schema.parse({
        accountProtection: {
          maskedAccountEmail: 'P***@yandex.ru',
          state: 'yandex_managed',
        },
      })
    },
  } as AuthenticatedTransport)

  await expect(api.getAccountProtection()).resolves.toEqual({
    accountProtection: {
      maskedAccountEmail: 'P***@yandex.ru',
      state: 'yandex_managed',
    },
  })
  expect(requests).toEqual(['/api/auth/account-protection'])
})
