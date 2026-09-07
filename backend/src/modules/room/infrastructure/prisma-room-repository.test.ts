import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaRoomRepository, toRoomRecord } from './prisma-room-repository'

const accountLifecycleSecret = 'room-account-lifecycle-test-secret'
const clock = { now: () => new Date('2026-07-24T12:00:00.000Z') }

test('projects every Prisma Room query shape through one canonical RoomRecord mapper', () => {
  const createdAt = new Date('2026-07-24T11:59:00.000Z')

  expect(toRoomRecord({
    capacity: 3,
    createdAt,
    hostId: 'host',
    id: 'room-1',
    joinCode: 'JOINCODE',
    members: [{ createdAt, ready: true, roomId: 'room-1', seat: 1, userId: 'host' }],
    startsAt: new Date('2026-07-24T12:00:05.000Z'),
    status: 'starting',
    tenderId: 'tender-1',
    updatedAt: createdAt,
  })).toEqual({
    capacity: 3,
    hostId: 'host',
    id: 'room-1',
    joinCode: 'JOINCODE',
    members: [{ ready: true, seat: 1, userId: 'host' }],
    startsAt: '2026-07-24T12:00:05.000Z',
    status: 'starting',
    tenderId: 'tender-1',
  })
})

test('does not create a Room for an anonymized account', async () => {
  const transactionClient = {
    $queryRaw: async () => [],
    user: {
      findFirst: async () => null,
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  await expect(createPrismaRoomRepository(
    db,
    clock,
    accountLifecycleSecret,
  ).create({
    capacity: 2,
    hostId: 'deleted-user',
  })).rejects.toMatchObject({ kind: 'room_account_unavailable' })
})

test('does not join a Room for an anonymized account', async () => {
  const transactionClient = {
    $queryRaw: async () => [],
    user: {
      findFirst: async () => null,
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => run(transactionClient),
  } as unknown as DbClient

  await expect(createPrismaRoomRepository(
    db,
    clock,
    accountLifecycleSecret,
  ).join({
    actorId: 'deleted-user',
    roomId: 'room-1',
  })).rejects.toMatchObject({ kind: 'room_account_unavailable' })
})

test('retries the complete ready transaction after a serializable write conflict', async () => {
  let transactionAttempts = 0
  const transactionClient = {
    $queryRaw: activeLifecycleQuery('user-2'),
    tenderRoom: {
      findFirst: async () => ({
        capacity: 2,
        hostId: 'user-1',
        id: 'room-1',
        joinCode: 'JOINCODE',
        members: [
          { ready: false, seat: 1, userId: 'user-1' },
          { ready: false, seat: 2, userId: 'user-2' },
        ],
        status: 'waiting',
        tenderId: null,
      }),
    },
    tenderRoomMember: {
      update: async () => ({ ready: true, userId: 'user-2' }),
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => {
      transactionAttempts += 1
      if (transactionAttempts === 1) {
        throw {
          cause: { kind: 'TransactionWriteConflict' },
          name: 'DriverAdapterError',
        }
      }
      return run(transactionClient)
    },
  } as unknown as DbClient

  const room = await createPrismaRoomRepository(db, clock, accountLifecycleSecret).setReady({
    actorId: 'user-2',
    ready: true,
    roomId: 'room-1',
  })

  expect(transactionAttempts).toBe(2)
  expect(room.members).toEqual([
    { ready: false, seat: 1, userId: 'user-1' },
    { ready: true, seat: 2, userId: 'user-2' },
  ])
})

test('retries a complete room join after a serializable write conflict', async () => {
  let transactionAttempts = 0
  const createdAt = new Date('2026-07-24T11:59:00.000Z')
  const transactionClient = {
    $queryRaw: activeLifecycleQuery('user-2'),
    currentMatch: {
      create: async () => ({ roomId: 'room-1', userId: 'user-2' }),
      findUnique: async () => null,
    },
    tenderRoom: {
      findUnique: async () => ({
        capacity: 4,
        createdAt,
        hostId: 'user-1',
        id: 'room-1',
        joinCode: 'JOINCODE',
        members: [
          { createdAt, ready: true, roomId: 'room-1', seat: 1, userId: 'user-1' },
        ],
        startsAt: null,
        status: 'waiting',
        tenderId: null,
        updatedAt: createdAt,
      }),
    },
    tenderRoomMember: {
      create: async () => ({ ready: false, roomId: 'room-1', seat: 2, userId: 'user-2' }),
      updateMany: async () => ({ count: 1 }),
    },
    user: {
      findFirst: async () => ({ id: 'user-2' }),
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => unknown) => {
      transactionAttempts += 1
      if (transactionAttempts === 1) {
        throw {
          cause: { code: '40001', kind: 'postgres' },
          name: 'DriverAdapterError',
        }
      }
      return run(transactionClient)
    },
  } as unknown as DbClient

  const room = await createPrismaRoomRepository(db, clock, accountLifecycleSecret).join({
    actorId: 'user-2',
    roomId: 'room-1',
  })

  expect(transactionAttempts).toBe(2)
  expect(room.members).toEqual([
    { ready: false, seat: 1, userId: 'user-1' },
    { ready: false, seat: 2, userId: 'user-2' },
  ])
})

function activeLifecycleQuery(userId: string) {
  return async (query: TemplateStringsArray) =>
    query.join('').includes('FROM "users"') ? [{ id: userId }] : []
}
