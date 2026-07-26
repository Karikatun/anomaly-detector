import { expect, test } from 'bun:test'

import { getSynchronizedCountdownSeconds } from '../src/platform/time/synchronized-countdown'

test('Tender countdown is identical for players with different local clocks', () => {
  const dueAt = '2026-07-25T12:01:30.000Z'
  const serverTime = '2026-07-25T12:00:00.000Z'

  expect(getSynchronizedCountdownSeconds(dueAt, serverTime, 20_250)).toBe(70)
  expect(getSynchronizedCountdownSeconds(dueAt, serverTime, 90_000)).toBe(0)
})
