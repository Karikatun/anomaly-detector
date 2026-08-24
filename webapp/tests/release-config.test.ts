import { describe, expect, test } from 'bun:test'

import { validateWebappReleaseEnvironment } from '../release-config'

const validEnvironment = {
  VITE_API_URL: 'https://api.anomaly-detector.ru',
  VITE_OAUTH_API_URL: 'https://api.anomaly-detector.ru',
  VITE_BUILD_SHA: '0123456789abcdef0123456789abcdef01234567',
  VITE_PUBLIC_LEGAL_OPERATOR_NAME: 'Оператор',
  VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT: 'Оператору',
  VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS: 'Проверенный адрес',
  VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE: '24 августа 2026 года',
}

describe('webapp split-domain release environment', () => {
  test('accepts the exact production origins, release SHA and legal values', () => {
    expect(() => validateWebappReleaseEnvironment(validEnvironment)).not.toThrow()
  })

  test('rejects an ambient analytics client flag in the prepared release', () => {
    expect(() => validateWebappReleaseEnvironment({
      ...validEnvironment,
      VITE_ANALYTICS_ENABLED: 'true',
    })).toThrow('VITE_ANALYTICS_ENABLED must be absent until production analytics is approved')
  })

  test.each([
    ['VITE_API_URL', undefined],
    ['VITE_API_URL', 'http://localhost:3000'],
    ['VITE_API_URL', 'https://api.anomaly-detector.ru/path'],
    ['VITE_OAUTH_API_URL', undefined],
    ['VITE_OAUTH_API_URL', 'https://anomaly-detector.ru'],
  ] as const)('rejects an unsafe %s value', (name, value) => {
    expect(() => validateWebappReleaseEnvironment({
      ...validEnvironment,
      [name]: value,
    })).toThrow(`${name} must equal https://api.anomaly-detector.ru`)
  })

  test.each([
    '',
    '0123456',
    '0123456789ABCDEF0123456789ABCDEF01234567',
    'g'.repeat(40),
  ])('rejects a non-release VITE_BUILD_SHA value', (value) => {
    expect(() => validateWebappReleaseEnvironment({
      ...validEnvironment,
      VITE_BUILD_SHA: value,
    })).toThrow('VITE_BUILD_SHA must be the exact lowercase 40-character release commit')
  })

  test.each([
    'VITE_PUBLIC_LEGAL_OPERATOR_NAME',
    'VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT',
    'VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS',
    'VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE',
  ] as const)('rejects an empty %s', (name) => {
    expect(() => validateWebappReleaseEnvironment({
      ...validEnvironment,
      [name]: ' ',
    })).toThrow(`${name} must be set for a public webapp build`)
  })
})
