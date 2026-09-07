import { expect, test } from 'bun:test'

import { RoomFailure } from '../domain/errors'
import { executeRoom } from './errors'

test('maps a Room mutation that loses its account lifecycle race to authentication failure', async () => {
  await expect(executeRoom(async () => {
    throw new RoomFailure('room_account_unavailable', 'Authentication is no longer active')
  })).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
    status: 401,
  })
})
