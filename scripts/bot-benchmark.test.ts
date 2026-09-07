import { expect, test } from 'bun:test'

import { assertCompleteHoldoutMatrix, ci95, holdoutCaseMatrix } from './bot-benchmark'

test('bot benchmark CI keeps empty and singleton intervals explicitly unknown', () => {
  expect(ci95([])).toEqual({ lower: null, mean: null, n: 0, upper: null })
  expect(ci95([7])).toEqual({ lower: null, mean: 7, n: 1, upper: null })
})

test('bot benchmark uses the known t(7) interval for eight seed clusters', () => {
  const interval = ci95([1, 2, 3, 4, 5, 6, 7, 8])

  expect(interval.mean).toBe(4.5)
  expect(interval.lower).toBeCloseTo(2.45184992, 6)
  expect(interval.upper).toBeCloseTo(6.54815008, 6)
})

test('holdout aggregation accepts only the complete frozen matrix', () => {
  expect(() => assertCompleteHoldoutMatrix(holdoutCaseMatrix)).not.toThrow()
  expect(() => assertCompleteHoldoutMatrix(holdoutCaseMatrix.slice(1))).toThrow('frozen case matrix')
  expect(() => assertCompleteHoldoutMatrix([...holdoutCaseMatrix, holdoutCaseMatrix[0]!])).toThrow('Duplicate')
  expect(() => assertCompleteHoldoutMatrix(holdoutCaseMatrix.map((caseInput, index) => index === 0
    ? { ...caseInput, composition: { bots: 1, humans: 99 } }
    : caseInput))).toThrow('frozen case matrix')
})
