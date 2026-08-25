import { expect, test } from 'bun:test'

import type { DbClient } from '../../../db'
import { createPrismaTenderOperationalStateReader } from './prisma-tender-operational-state'

test('reads only aggregate Tender lifecycle and deadline counts', async () => {
  const db = {
    $queryRaw: async () => [{
      active: 3n,
      completed: 5n,
      early_finished: 2n,
      overdue: 1n,
    }],
  } as unknown as DbClient
  const reader = createPrismaTenderOperationalStateReader(db)

  await expect(reader.read(new Date('2026-08-25T10:00:00.000Z'))).resolves.toEqual({
    active: 3,
    completed: 5,
    earlyFinished: 2,
    overdue: 1,
  })
})

test('fails closed instead of exporting impossible or unsafe database counts', async () => {
  const db = {
    $queryRaw: async () => [{
      active: -1n,
      completed: 0n,
      early_finished: 0n,
      overdue: 0n,
    }],
  } as unknown as DbClient

  await expect(createPrismaTenderOperationalStateReader(db).read(new Date()))
    .rejects.toThrow('Invalid Tender operational state')
})
