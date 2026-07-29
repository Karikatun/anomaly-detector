import { expect, test } from 'bun:test'

import { powerAllocationLimits, powerAllocationProblem } from '../src/features/tender/power-allocation-constraints'

test('limits Reconnaissance power to the number of missing Samples', () => {
  expect(powerAllocationLimits(5)).toMatchObject({ reconnaissance: 1 })
  expect(powerAllocationLimits(6)).toMatchObject({ reconnaissance: 0 })
  expect(powerAllocationLimits(0)).toMatchObject({ modelAnalysis: 2 })
})

test('requires enough existing and planned Samples for a Laboratory test', () => {
  expect(powerAllocationProblem({
    allocation: { contracts: 1, laboratory: 1, modelAnalysis: 1, reconnaissance: 1 },
    sampleCount: 0,
  })).toBe('laboratory-needs-two-samples')

  expect(powerAllocationProblem({
    allocation: { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 2 },
    sampleCount: 0,
  })).toBeNull()
})
