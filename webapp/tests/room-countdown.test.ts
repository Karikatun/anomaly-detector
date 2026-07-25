import { expect, test } from 'bun:test'

import { getRoomStartCountdownSeconds } from '../src/features/rooms/countdown'

test('room start countdown never begins above five when the lobby clock is stale', () => {
  const startsAt = '2026-07-25T12:00:15.000Z'
  const staleLobbyClock = Date.parse('2026-07-25T12:00:00.000Z')

  expect(getRoomStartCountdownSeconds(startsAt, staleLobbyClock)).toBe(5)
})

test('room start countdown preserves active seconds and stops at zero', () => {
  const startsAt = '2026-07-25T12:00:05.000Z'

  expect(getRoomStartCountdownSeconds(startsAt, Date.parse('2026-07-25T12:00:02.100Z'))).toBe(3)
  expect(getRoomStartCountdownSeconds(startsAt, Date.parse('2026-07-25T12:00:06.000Z'))).toBe(0)
})
