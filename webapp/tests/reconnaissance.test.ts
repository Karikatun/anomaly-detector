import { expect, test } from 'bun:test'

import {
  availableReconnaissanceTargets,
  toggleReconnaissanceTarget,
} from '../src/features/tender/reconnaissance-targets'

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

test('keeps two reconnaissance selections unique, reversible, and within the action limit', () => {
  const first = toggleReconnaissanceTarget(new Set(), 'unknown-sector-1', 2)
  const second = toggleReconnaissanceTarget(first, 'boreal', 2)
  const blockedThird = toggleReconnaissanceTarget(second, 'cinder', 2)
  const deselected = toggleReconnaissanceTarget(blockedThird, 'unknown-sector-1', 2)
  const selectedAgain = toggleReconnaissanceTarget(deselected, 'boreal', 2)

  expect([...first]).toEqual(['unknown-sector-1'])
  expect([...second]).toEqual(['unknown-sector-1', 'boreal'])
  expect([...blockedThird]).toEqual(['unknown-sector-1', 'boreal'])
  expect([...deselected]).toEqual(['boreal'])
  expect([...selectedAgain]).toEqual([])
})
