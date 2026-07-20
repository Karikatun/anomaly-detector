import { expect, test } from 'bun:test'

import { TenderRoomService } from './room-service'

test('creates a waiting private room with its host in the first seat', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async (input) => ({
        capacity: input.capacity,
        hostId: input.hostId,
        id: 'room-1',
        members: [{ seat: 1, userId: input.hostId }],
        status: 'waiting',
        tenderId: null,
      }),
    },
  })

  await expect(service.createRoom({ capacity: 3, hostId: 'user-1' })).resolves.toEqual({
    capacity: 3,
    hostId: 'user-1',
    members: [{ seat: 1, userId: 'user-1' }],
    roomId: 'room-1',
    status: 'waiting',
  })
})
