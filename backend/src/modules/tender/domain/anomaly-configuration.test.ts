import { expect, test } from 'bun:test'

import { createAnomalyConfiguration, resolvePublicResult } from './anomaly-configuration'

test('builds all six unique Signal property pairs from a seed', () => {
  const configuration = createAnomalyConfiguration('seed-1')

  expect(configuration.seed).toBe('seed-1')
  expect(
    Object.values(configuration.signals)
      .map((signal) => `${signal.fieldType}:${signal.polarity}`)
      .sort(),
  ).toEqual([
    'electromagnetic:negative',
    'electromagnetic:positive',
    'inertial:negative',
    'inertial:positive',
    'phase:negative',
    'phase:positive',
  ])
})

test('resolves public results by source direction and polarity', () => {
  expect(
    resolvePublicResult({ fieldType: 'inertial', polarity: 'positive' }, { fieldType: 'inertial', polarity: 'positive' }),
  ).toBe('transmission_gain')
  expect(
    resolvePublicResult({ fieldType: 'inertial', polarity: 'positive' }, { fieldType: 'inertial', polarity: 'negative' }),
  ).toBe('attenuation')
  expect(
    resolvePublicResult({ fieldType: 'inertial', polarity: 'positive' }, { fieldType: 'electromagnetic', polarity: 'positive' }),
  ).toBe('reflection')
  expect(
    resolvePublicResult({ fieldType: 'inertial', polarity: 'positive' }, { fieldType: 'electromagnetic', polarity: 'negative' }),
  ).toBe('unstable_collapse')
  expect(
    resolvePublicResult({ fieldType: 'electromagnetic', polarity: 'positive' }, { fieldType: 'inertial', polarity: 'positive' }),
  ).toBe('attenuation')
  expect(
    resolvePublicResult({ fieldType: 'electromagnetic', polarity: 'positive' }, { fieldType: 'inertial', polarity: 'negative' }),
  ).toBe('transmission_gain')
})
