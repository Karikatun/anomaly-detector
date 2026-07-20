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
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
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

test('adds a player to the next available seat in a waiting room', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => ({
        capacity: 3,
        hostId: 'user-1',
        id: 'room-1',
        members: [{ seat: 1, userId: 'user-1' }, { seat: 2, userId: 'user-2' }],
        status: 'waiting',
        tenderId: null,
      }),
      leave: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.joinRoom({ actorId: 'user-2', roomId: 'room-1' })).resolves.toMatchObject({
    members: [{ seat: 1, userId: 'user-1' }, { seat: 2, userId: 'user-2' }],
    roomId: 'room-1',
  })
})

test('lets a player leave a waiting room', async () => {
  const left: Array<{ actorId: string; roomId: string }> = []
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async (input) => { left.push(input) },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.leaveRoom({ actorId: 'user-2', roomId: 'room-1' })).resolves.toBeUndefined()
  expect(left).toEqual([{ actorId: 'user-2', roomId: 'room-1' }])
})

test('starts a full room and exposes its Tender id', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      start: async () => ({
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        members: [{ seat: 1, userId: 'user-1' }, { seat: 2, userId: 'user-2' }],
        status: 'started',
        tenderId: 'tender-1',
      }),
    },
  })

  await expect(service.startRoom({ actorId: 'user-1', roomId: 'room-1' })).resolves.toEqual({
    capacity: 2,
    hostId: 'user-1',
    members: [{ seat: 1, userId: 'user-1' }, { seat: 2, userId: 'user-2' }],
    roomId: 'room-1',
    status: 'started',
    tenderId: 'tender-1',
  })
})
