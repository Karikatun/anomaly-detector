import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createRoomStartModule } from '../index'

const now = new Date('2026-07-24T12:00:05.000Z')

test('retries a serializable Room start conflict and re-reads current Room state', async () => {
  let roomReads = 0
  let transactionAttempts = 0
  const transactionClient = {
    tenderRoom: {
      findUnique: async () => {
        roomReads += 1
        return null
      },
    },
  }
  const db = {
    $transaction: async (run: (tx: typeof transactionClient) => Promise<unknown>) => {
      transactionAttempts += 1
      const result = await run(transactionClient)
      if (transactionAttempts === 1) throw { code: 'P2034' }
      return result
    },
    tenderRoom: {
      findMany: async () => [{ id: 'room-1' }],
    },
  } as unknown as DbClient

  await expect(createRoomStartModule(db).advanceDueRoomStarts({ now })).resolves.toEqual({ started: [] })
  expect(transactionAttempts).toBe(2)
  expect(roomReads).toBe(2)
})

test('stops retrying a Room start after three serializable conflicts', async () => {
  let transactionAttempts = 0
  const conflict = { code: 'P2034' }
  const db = {
    $transaction: async () => {
      transactionAttempts += 1
      throw conflict
    },
    tenderRoom: {
      findMany: async () => [{ id: 'room-1' }],
    },
  } as unknown as DbClient

  await expect(createRoomStartModule(db).advanceDueRoomStarts({ now })).rejects.toBe(conflict)
  expect(transactionAttempts).toBe(3)
})

test('does not retry a non-transactional Room start failure', async () => {
  let transactionAttempts = 0
  const failure = new Error('database unavailable')
  const db = {
    $transaction: async () => {
      transactionAttempts += 1
      throw failure
    },
    tenderRoom: {
      findMany: async () => [{ id: 'room-1' }],
    },
  } as unknown as DbClient

  await expect(createRoomStartModule(db).advanceDueRoomStarts({ now })).rejects.toBe(failure)
  expect(transactionAttempts).toBe(1)
})
