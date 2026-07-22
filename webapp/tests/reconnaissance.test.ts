import { expect, test } from 'bun:test'

import { availableReconnaissanceSignals } from '../src/features/tender/ReconnaissancePanel'

test('offers every uncollected Signal for Reconnaissance, including non-public ones', () => {
  expect(availableReconnaissanceSignals(['aster'])).toEqual([
    'boreal',
    'cinder',
    'delta',
    'eclipse',
    'ferro',
  ])
})
