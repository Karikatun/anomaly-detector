import { expect, test } from 'bun:test'

import { TenderRoomService } from './room-service'
import { RoomFailure } from '../domain/errors'

test('creates a waiting private room with its host in the first seat', async () => {
  const service = new TenderRoomService({
    memberIdentityReader: {
      readDisplayNames: async () => new Map([['user-1', 'Хост']]),
    },
    repository: {
      create: async (input) => ({
        capacity: input.capacity,
        hostId: input.hostId,
        id: 'room-1',
        members: [{ ready: false, seat: 1, userId: input.hostId }],
        status: 'waiting',
        tenderId: null,
      }),
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.createRoom({ capacity: 3, hostId: 'user-1' })).resolves.toEqual({
    capacity: 3,
    hostId: 'user-1',
    joinCode: null,
    members: [{ displayName: 'Хост', ready: false, seat: 1, userId: 'user-1' }],
    roomId: 'room-1',
    serverTime: expect.any(String),
    status: 'waiting',
  })
})

test('lists started matches for the requesting player', async () => {
  const service = new TenderRoomService({
    matchPlacementReader: {
      readPlacement: async ({ playerId, tenderId }) => {
        expect({ playerId, tenderId }).toEqual({ playerId: 'user-1', tenderId: 'tender-1' })
        return 2
      },
    },
    repository: {
      create: async () => { throw new Error('not used') },
      listStartedForMember: async (userId) => [{
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        members: [{ ready: true, seat: 1, userId }, { ready: true, seat: 2, userId: 'user-2' }],
        status: 'started',
        tenderId: 'tender-1',
      }],
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
    tenderLifecycleReader: {
      readLifecycle: async ({ playerId, tenderId }) => {
        expect({ playerId, tenderId }).toEqual({ playerId: 'user-1', tenderId: 'tender-1' })
        return {
          forfeited: false,
          phase: 'complete',
          ruleset: 'tender-v2',
        }
      },
    },
  })

  await expect(service.listMatches('user-1')).resolves.toEqual([{
    capacity: 2,
    hostId: 'user-1',
    joinCode: null,
    members: [
      { displayName: 'Исследователь', ready: true, seat: 1, userId: 'user-1' },
      { displayName: 'Исследователь', ready: true, seat: 2, userId: 'user-2' },
    ],
    roomId: 'room-1',
    serverTime: expect.any(String),
    status: 'started',
    tenderId: 'tender-1',
    tenderPhase: 'complete',
    tenderPlacement: 2,
    tenderRuleset: 'tender-v2',
  }])
})

test('releases a forfeited current match using the Tender lifecycle port', async () => {
  const released: Array<{ roomId: string; userId: string }> = []
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      readCurrentForMember: async () => ({
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        members: [{ ready: true, seat: 1, userId: 'user-1' }],
        status: 'started',
        tenderId: 'tender-1',
      }),
      releaseCurrentForMember: async (input) => { released.push(input) },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
    tenderLifecycleReader: {
      readLifecycle: async () => ({
        forfeited: true,
        phase: 'access-slot-selection',
        ruleset: 'tender-v2',
      }),
    },
  })

  await expect(service.getCurrentMatch('user-1')).resolves.toBeNull()
  expect(released).toEqual([{ roomId: 'room-1', userId: 'user-1' }])
})

test('joins a waiting room through its public join code', async () => {
  const joinedByCode: Array<{ actorId: string; code: string }> = []
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('UUID join must not be used') },
      joinByCode: async (input) => {
        joinedByCode.push(input)
        return {
          capacity: 2,
          hostId: 'user-1',
          id: 'room-1',
          joinCode: '7K9M2NP4RX',
          members: [
            { ready: false, seat: 1, userId: 'user-1' },
            { ready: false, seat: 2, userId: input.actorId },
          ],
          status: 'waiting',
          tenderId: null,
        }
      },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.joinRoomByCode({
    actorId: 'user-2',
    code: '7K9M2NP4RX',
  })).resolves.toMatchObject({
    joinCode: '7K9M2NP4RX',
    roomId: 'room-1',
  })
  expect(joinedByCode).toEqual([{ actorId: 'user-2', code: '7K9M2NP4RX' }])
})

test('reads room state for an existing member without joining again', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      readForMember: async () => ({
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        members: [
          { ready: true, seat: 1, userId: 'user-1' },
          { ready: false, seat: 2, userId: 'user-2' },
        ],
        status: 'waiting',
        tenderId: null,
      }),
      join: async () => { throw new Error('GET must not join the room') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.getRoom({ actorId: 'user-2', roomId: 'room-1' })).resolves.toMatchObject({
    roomId: 'room-1',
    members: [{ userId: 'user-1' }, { userId: 'user-2' }],
  })
})

test('lets a player leave a waiting room', async () => {
  const left: Array<{ actorId: string; roomId: string }> = []
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async (input) => { left.push(input) },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.leaveRoom({ actorId: 'user-2', roomId: 'room-1' })).resolves.toBeUndefined()
  expect(left).toEqual([{ actorId: 'user-2', roomId: 'room-1' }])
})

test('schedules a full room start and exposes its server start time', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      start: async () => ({
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        members: [{ ready: true, seat: 1, userId: 'user-1' }, { ready: true, seat: 2, userId: 'user-2' }],
        status: 'starting',
        startsAt: '2026-07-24T12:00:05.000Z',
        tenderId: null,
      }),
      setReady: async () => { throw new Error('not used') },
    },
  })

  await expect(service.startRoom({ actorId: 'user-1', roomId: 'room-1' })).resolves.toEqual({
    capacity: 2,
    hostId: 'user-1',
    joinCode: null,
    members: [
      { displayName: 'Исследователь', ready: true, seat: 1, userId: 'user-1' },
      { displayName: 'Исследователь', ready: true, seat: 2, userId: 'user-2' },
    ],
    roomId: 'room-1',
    serverTime: expect.any(String),
    status: 'starting',
    startsAt: '2026-07-24T12:00:05.000Z',
  })
})

test('lets the host cancel a scheduled room start', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      cancelStart: async () => ({
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        members: [{ ready: true, seat: 1, userId: 'user-1' }, { ready: true, seat: 2, userId: 'user-2' }],
        status: 'waiting',
        startsAt: null,
        tenderId: null,
      }),
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.cancelRoomStart({ actorId: 'user-1', roomId: 'room-1' })).resolves.toEqual({
    capacity: 2,
    hostId: 'user-1',
    joinCode: null,
    members: [
      { displayName: 'Исследователь', ready: true, seat: 1, userId: 'user-1' },
      { displayName: 'Исследователь', ready: true, seat: 2, userId: 'user-2' },
    ],
    roomId: 'room-1',
    serverTime: expect.any(String),
    status: 'waiting',
  })
})

test('allows creating a room with the minimum capacity of two', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async (input) => ({
        capacity: input.capacity,
        hostId: input.hostId,
        id: 'room-2',
        members: [{ ready: false, seat: 1, userId: input.hostId }],
        status: 'waiting',
        tenderId: null,
      }),
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.createRoom({ capacity: 2, hostId: 'user-1' })).resolves.toMatchObject({
    capacity: 2,
    members: [{ ready: false, seat: 1, userId: 'user-1' }],
  })
})

test('allows creating a room with the maximum capacity of four', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async (input) => ({
        capacity: input.capacity,
        hostId: input.hostId,
        id: 'room-4',
        members: [{ ready: false, seat: 1, userId: input.hostId }],
        status: 'waiting',
        tenderId: null,
      }),
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new Error('not used') },
    },
  })

  await expect(service.createRoom({ capacity: 4, hostId: 'user-1' })).resolves.toMatchObject({
    capacity: 4,
    members: [{ ready: false, seat: 1, userId: 'user-1' }],
  })
})

test('propagates a repository error when a non-host tries to start a room', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new RoomFailure('room_not_host', 'Only the host can start') },
    },
  })

  await expect(
    service.startRoom({ actorId: 'user-2', roomId: 'room-1' }),
  ).rejects.toMatchObject({ kind: 'room_not_host' })
})

test('propagates a repository error when starting a room that is not full', async () => {
  const service = new TenderRoomService({
    repository: {
      create: async () => { throw new Error('not used') },
      join: async () => { throw new Error('not used') },
      leave: async () => { throw new Error('not used') },
      setReady: async () => { throw new Error('not used') },
      start: async () => { throw new RoomFailure('room_full', 'Room needs every seat filled') },
    },
  })

  await expect(
    service.startRoom({ actorId: 'user-1', roomId: 'room-1' }),
  ).rejects.toMatchObject({ kind: 'room_full' })
})
