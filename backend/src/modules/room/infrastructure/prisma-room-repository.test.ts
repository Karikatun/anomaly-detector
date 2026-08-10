import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaRoomRepository, toRoomRecord } from './prisma-room-repository'

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

test('retries the complete ready transaction after a serializable write conflict', async () => {
  let transactionAttempts = 0
  const transactionClient = {
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

  const room = await createPrismaRoomRepository(db).setReady({
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
