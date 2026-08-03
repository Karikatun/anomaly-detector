import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaRoomRepository } from './prisma-room-repository'

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
