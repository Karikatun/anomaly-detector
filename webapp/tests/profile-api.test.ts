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
