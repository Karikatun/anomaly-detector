import { expect, test } from 'bun:test'

import { availableReconnaissanceTargets } from '../src/features/tender/reconnaissance-targets'

test('offers unknown sectors and known Signals without an owned Sample for Reconnaissance', () => {
  expect(availableReconnaissanceTargets({ knownSignals: ['aster', 'boreal'], mySamples: ['aster'] })).toEqual([
    'unknown-sector-1',
    'unknown-sector-2',
    'boreal',
  ])
})

test('offers only one Reconnaissance target when the player lacks one Sample', () => {
  expect(availableReconnaissanceTargets({
    knownSignals: ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'],
    mySamples: ['aster', 'boreal', 'cinder', 'delta', 'eclipse'],
  })).toEqual(['ferro'])
})

test('does not offer phantom Unknown Sectors after every Signal is public', () => {
  expect(availableReconnaissanceTargets({
    knownSignals: ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'],
    mySamples: [],
  })).toEqual(['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'])
})
