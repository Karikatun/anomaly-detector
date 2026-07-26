import { describe, expect, test } from 'bun:test'

import {
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  oauthCallbackQuerySchema,
  oauthProviderSchema,
  oauthStartRequestSchema,
  oauthStartResponseSchema,
  registerRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
} from './index'

const validUser = {
  id: 'user_1',
  login: 'user',
  displayName: null,
  locale: 'ru' as const,
  createdAt: '2026-05-11T00:00:00.000Z',
}

describe('auth contracts', () => {
  test('normalizes registration and login input', () => {
    expect(
      registerRequestSchema.parse({
        login: ' USER_1 ',
        password: 'password123',
        displayName: ' Jane ',
        privacyConsent: true,
      }),
    ).toEqual({
      login: 'user_1',
      password: 'password123',
      displayName: 'Jane',
      privacyConsent: true,
    })

    expect(
      registerRequestSchema.parse({
        login: 'user',
        password: 'password123',
        displayName: '',
        privacyConsent: true,
      }),
    ).toEqual({
      login: 'user',
      password: 'password123',
      displayName: undefined,
      privacyConsent: true,
    })

    expect(
      loginRequestSchema.parse({
        login: ' USER_1 ',
        password: 'password123',
      }),
    ).toEqual({
      login: 'user_1',
      password: 'password123',
    })
  })

  test('rejects invalid auth request payloads', () => {
    expect(() =>
      registerRequestSchema.parse({
        login: 'not a login',
        password: 'short',
        displayName: 'A',
        privacyConsent: true,
      }),
    ).toThrow()

    expect(() =>
      registerRequestSchema.parse({
        login: 'user',
        password: 'short',
        privacyConsent: true,
      }),
    ).toThrow()

    expect(() =>
      loginRequestSchema.parse({
        login: 'user',
        password: 'short',
      }),
    ).toThrow()

    // Rejects missing privacy consent
    expect(() =>
      registerRequestSchema.parse({
        login: 'user',
        password: 'password123',
      }),
    ).toThrow()

    // Rejects falsy consent values
    expect(() =>
      registerRequestSchema.parse({
        login: 'user',
        password: 'password123',
        privacyConsent: false,
      }),
    ).toThrow()
  })

  test('keeps cookie requests empty and requires explicit token transport credentials', () => {
    expect(cookieRefreshRequestSchema.parse(undefined)).toEqual({})
    expect(cookieRefreshRequestSchema.parse({})).toEqual({})
    expect(cookieLogoutRequestSchema.parse(undefined)).toEqual({})
    expect(cookieLogoutRequestSchema.parse({})).toEqual({})

    const refreshToken = 'r'.repeat(32)
    expect(tokenRefreshRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })
    expect(tokenLogoutRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })

    expect(() => cookieRefreshRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => cookieLogoutRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => tokenRefreshRequestSchema.parse({})).toThrow()
    expect(() => tokenLogoutRequestSchema.parse({ refreshToken: 'short' })).toThrow()
  })

  test('keeps cookie responses token-free and requires tokens for explicit token transport', () => {
    expect(
      cookieAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
      }),
    ).toEqual({
      user: validUser,
      accessToken: 'access-token',
    })

    expect(() =>
      cookieAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
        refreshToken: 'must-not-be-exposed',
      }),
    ).toThrow()

    expect(
      tokenAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
        refreshToken: 'token-transport-refresh-token',
      }),
    ).toEqual({
      user: validUser,
      accessToken: 'access-token',
      refreshToken: 'token-transport-refresh-token',
    })

    expect(() => tokenAuthResponseSchema.parse({ user: validUser, accessToken: 'access-token' })).toThrow()
    expect(cookieRefreshResponseSchema.parse({ accessToken: 'access-token' })).toEqual({
      accessToken: 'access-token',
    })
    expect(
      tokenRefreshResponseSchema.parse({
        accessToken: 'access-token',
        refreshToken: 'token-transport-refresh-token',
      }),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'token-transport-refresh-token',
    })
    expect(meResponseSchema.parse({ user: validUser })).toEqual({ user: validUser })
  })

  test('validates stable API error response shape', () => {
    expect(
      apiErrorSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: [{ path: ['login'], message: 'Invalid login' }],
        },
      }),
    ).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: [{ path: ['login'], message: 'Invalid login' }],
      },
    })

    expect(() =>
      apiErrorSchema.parse({
        error: {
          code: 'SOMETHING_ELSE',
          message: 'Nope',
        },
      }),
    ).toThrow()
  })

  test('validates OAuth start request and response', () => {
    const start = oauthStartRequestSchema.parse({
      webappOrigin: 'http://localhost:5173',
    })
    expect(start.webappOrigin).toBe('http://localhost:5173')

    // webappOrigin is optional — the backend falls back to its configured origin.
    expect(oauthStartRequestSchema.parse({}).webappOrigin).toBeUndefined()

    expect(() => oauthStartRequestSchema.parse({ redirectUri: 'https://attacker.example/callback' })).toThrow()

    const response = oauthStartResponseSchema.parse({
      authorizationUrl: 'https://oauth.yandex.ru/authorize?state=abc',
    })
    expect(response.authorizationUrl).toContain('state=abc')
  })

  test('validates OAuth provider param', () => {
    expect(oauthProviderSchema.parse('yandex')).toBe('yandex')
    expect(oauthProviderSchema.parse('vk')).toBe('vk')
    expect(() => oauthProviderSchema.parse('google')).toThrow()
    expect(() => oauthProviderSchema.parse('')).toThrow()
  })

  test('validates OAuth callback query', () => {
    // success: code + state
    const query = oauthCallbackQuerySchema.parse({
      code: 'auth-code-123',
      state: 'state-abc-def',
    })
    expect(query.code).toBe('auth-code-123')
    expect(query.state).toBe('state-abc-def')

    // error: error + state (OAuth provider returned an error)
    const errorQuery = oauthCallbackQuerySchema.parse({
      error: 'invalid_request',
      state: 'state-abc-def',
    })
    expect(errorQuery.error).toBe('invalid_request')
    expect(errorQuery.state).toBe('state-abc-def')

    // error with description
    const errorDescQuery = oauthCallbackQuerySchema.parse({
      error: 'access_denied',
      error_description: 'User denied',
      state: 'state-abc-def',
    })
    expect(errorDescQuery.error).toBe('access_denied')
    expect(errorDescQuery.error_description).toBe('User denied')

    // rejections
    expect(() => oauthCallbackQuerySchema.parse({ code: '', state: 'state' })).toThrow()
    expect(() => oauthCallbackQuerySchema.parse({ code: 'code', state: '' })).toThrow()
    expect(() => oauthCallbackQuerySchema.parse({})).toThrow()
    expect(() => oauthCallbackQuerySchema.parse({ state: 'state' })).toThrow() // neither code nor error
  })
})
