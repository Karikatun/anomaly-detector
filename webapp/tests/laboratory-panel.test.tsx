import { expect, test } from 'bun:test'
import { isLaboratoryPairResearched } from '../src/features/tender/laboratory-pair'

test('marks an own researched directed pair unavailable without blocking another direction', () => {
  const journal = [{
    playerId: 'player-a',
    protocol: 'continuous' as const,
    publicResult: 'reflection' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'r1-t1',
  }]

  expect(isLaboratoryPairResearched({
    journal,
    playerId: 'player-a',
    receiverSignal: 'boreal',
    sourceSignal: 'aster',
  })).toBe(true)
  expect(isLaboratoryPairResearched({
    journal,
    playerId: 'player-a',
    receiverSignal: 'aster',
    sourceSignal: 'boreal',
  })).toBe(false)
  expect(isLaboratoryPairResearched({
    journal,
    playerId: 'player-b',
    receiverSignal: 'boreal',
    sourceSignal: 'aster',
  })).toBe(false)
})
