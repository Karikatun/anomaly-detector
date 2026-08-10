import { expect, test } from 'bun:test'

import { deadlineForPhase } from './phase-timing'

const now = new Date('2026-07-29T12:00:00.000Z')

test('uses the shared planning deadline for ordinary phases', () => {
  expect(deadlineForPhase('power-allocation', now)?.toISOString())
    .toBe('2026-07-29T12:01:30.000Z')
})

test('gives the final scientific model more time and completed Tenders no deadline', () => {
  expect(deadlineForPhase('final-scientific-model', now)?.toISOString())
    .toBe('2026-07-29T12:03:00.000Z')
  expect(deadlineForPhase('complete', now)).toBeNull()
})
