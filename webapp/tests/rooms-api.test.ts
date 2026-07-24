import { expect, test } from 'bun:test'

import type { AuthenticatedTransport } from '../src/platform/api'
import { RoomsApi } from '../src/features/rooms/api'

test('room refresh reads current state without repeating the join mutation', async () => {
  const requests: Array<{ method?: string; path: string }> = []
  const api = new RoomsApi({
    request: async (path, schema, options) => {
      requests.push({ method: options?.method, path })
      return schema.parse({
        capacity: 2,
        hostId: '019be000-0000-7000-8000-000000000002',
        members: [{ ready: false, seat: 1, userId: '019be000-0000-7000-8000-000000000002' }],
        roomId: '019be000-0000-7000-8000-000000000001',
        status: 'waiting',
      })
    },
  } as AuthenticatedTransport)

  await api.get('019be000-0000-7000-8000-000000000001')

  expect(requests).toEqual([{
    method: undefined,
    path: '/api/rooms/019be000-0000-7000-8000-000000000001',
  }])
})
