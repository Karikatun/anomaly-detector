import { describe, expect, test } from 'bun:test'
import { registerRequestSchema } from '@anomaly-detector/contracts'

describe('contracts', () => {
  test('normalizes auth registration payloads', () => {
    const result = registerRequestSchema.parse({
      email: ' USER@Example.COM ',
      password: 'password123',
      displayName: '',
      privacyConsent: true,
      ageConfirmation: true,
    })

    expect(result).toEqual({
      email: 'user@example.com',
      password: 'password123',
      displayName: undefined,
      privacyConsent: true,
      ageConfirmation: true,
    })
  })
})
