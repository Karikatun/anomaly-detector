import { expect, test } from 'bun:test'

import { createRoomRequestSchema, roomViewSchema } from './room'

test('Room contracts accept a waiting private room for two to four players', () => {
  expect(createRoomRequestSchema.parse({ capacity: 3 })).toEqual({ capacity: 3 })
  expect(() => createRoomRequestSchema.parse({ capacity: 5 })).toThrow()
  expect(roomViewSchema.parse({
    capacity: 3,
    hostId: '019f8099-7e26-7760-ad08-66d1d66b2717',
    members: [{ seat: 1, userId: '019f8099-7e26-7760-ad08-66d1d66b2718' }],
    roomId: '019f8099-7e26-7760-ad08-66d1d66b2719',
    status: 'waiting',
  })).toMatchObject({ capacity: 3, status: 'waiting' })
})
