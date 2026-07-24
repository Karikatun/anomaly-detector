import { expect, test } from 'bun:test'

import { availableReconnaissanceTargets } from '../src/features/tender/reconnaissance-targets'

test('offers unknown sectors and known Signals without an owned Sample for Reconnaissance', () => {
  expect(availableReconnaissanceTargets({ knownSignals: ['aster', 'boreal'], mySamples: ['aster'] })).toEqual([
    'unknown-sector-1',
    'unknown-sector-2',
    'boreal',
  ])
})
