import { describe, expect, test } from 'bun:test'
import { registerRequestSchema } from '@anomaly-detector/contracts'

describe('contracts', () => {
  test('normalizes auth registration payloads', () => {
    const result = registerRequestSchema.parse({
      login: ' USER_1 ',
      password: 'password123',
      displayName: '',
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsVersion: '1.0',
    })

    expect(result).toEqual({
      login: 'user_1',
      password: 'password123',
      displayName: undefined,
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsVersion: '1.0',
    })
  })
})
