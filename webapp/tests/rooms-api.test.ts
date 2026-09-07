import { expect, test } from 'bun:test'

import type { AuthenticatedTransport } from '../src/platform/api'
import { RoomsApi } from '../src/features/rooms/api'

test('room refresh reads current state without repeating the join mutation', async () => {
  const requests: Array<{ method?: string; path: string }> = []
  const api = new RoomsApi({
    request: async (path, schema, options) => {
      requests.push({ method: options?.method, path })
      return schema.parse({
        allowBots: false,
        capacity: 2,
        hostId: '019be000-0000-7000-8000-000000000002',
        joinCode: '7K9M2NP4RX',
        members: [{
          displayName: 'Хост',
          ready: false,
          seat: 1,
          userId: '019be000-0000-7000-8000-000000000002',
        }],
        roomId: '019be000-0000-7000-8000-000000000001',
        serverTime: '2026-07-26T12:00:00.000Z',
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

test('leaving a waiting room accepts the successful no-content response', async () => {
  const roomId = '019be000-0000-7000-8000-000000000001'
  const api = new RoomsApi({
    request: async () => {
      throw new Error('Expected a JSON response')
    },
    requestNoContent: async (path, options) => {
      expect(path).toBe(`/api/rooms/${roomId}/leave`)
      expect(options?.method).toBe('POST')
    },
  } as AuthenticatedTransport)

  await expect(api.leave(roomId)).resolves.toBeUndefined()
})

test('host bot mutations use the room roster endpoints and return the reconciled room view', async () => {
  const roomId = '019be000-0000-7000-8000-000000000001'
  const botId = '019be000-0000-7000-8000-000000000003'
  const requests: Array<{ body?: unknown; method?: string; path: string }> = []
  const api = new RoomsApi({
    request: async (path, schema, options) => {
      requests.push({ body: options?.body, method: options?.method, path })
      return schema.parse({
        allowBots: true,
        bots: [{ difficulty: 'easy', id: botId, seat: 2 }],
        capacity: 2,
        hostId: '019be000-0000-7000-8000-000000000002',
        joinCode: '7K9M2NP4RX',
        members: [{
          displayName: 'Хост',
          ready: false,
          seat: 1,
          userId: '019be000-0000-7000-8000-000000000002',
        }],
        roomId,
        serverTime: '2026-07-26T12:00:00.000Z',
        status: 'waiting',
      })
    },
  } as AuthenticatedTransport)

  await api.addBot(roomId, 2)
  await api.removeBot(roomId, botId)

  expect(requests).toEqual([
    { body: { difficulty: 'easy', seat: 2 }, method: 'POST', path: `/api/rooms/${roomId}/bots` },
    { method: 'DELETE', path: `/api/rooms/${roomId}/bots/${botId}` },
  ])
})
