import { expect, test } from 'bun:test'

import {
  nextMarkerState,
  transitionMarkerValue,
} from '../src/features/tender/working-model-marker'

test('Working Model marker cycles through possible, excluded, and cleared states', () => {
  expect(nextMarkerState('unset')).toBe('possible')
  expect(nextMarkerState('possible')).toBe('excluded')
  expect(nextMarkerState('excluded')).toBe('unset')
})

test('Working Model applies the same complete marker cycle to field types and polarities', () => {
  expect(transitionMarkerValue('phase', 'unset', [], [])).toEqual({
    excluded: [],
    possible: ['phase'],
  })
  expect(transitionMarkerValue('phase', 'possible', ['phase'], [])).toEqual({
    excluded: ['phase'],
    possible: [],
  })
  expect(transitionMarkerValue('negative', 'excluded', [], ['negative'])).toEqual({
    excluded: [],
    possible: [],
  })
})
