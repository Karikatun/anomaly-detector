import { expect, test } from 'bun:test'

import {
  getRoomPollingIntervalMs,
  getRoomStartCountdownSeconds,
} from '../src/features/rooms/countdown'

test('room start countdown never begins above five when the lobby clock is stale', () => {
  const startsAt = '2026-07-25T12:00:15.000Z'
  const serverTime = '2026-07-25T12:00:10.000Z'

  expect(getRoomStartCountdownSeconds(startsAt, serverTime, 0)).toBe(5)
})

test('room start countdown ignores different player clock offsets', () => {
  const startsAt = '2026-07-25T12:00:05.000Z'
  const serverTime = '2026-07-25T12:00:00.000Z'

  expect(getRoomStartCountdownSeconds(startsAt, serverTime, 2_100)).toBe(3)
  expect(getRoomStartCountdownSeconds(startsAt, serverTime, 6_000)).toBe(0)
})

test('lobby checks for a shared start quickly enough for every player to see the countdown', () => {
  expect(getRoomPollingIntervalMs('waiting')).toBe(1_000)
  expect(getRoomPollingIntervalMs('starting')).toBe(250)
  expect(getRoomPollingIntervalMs('started')).toBe(false)
})
