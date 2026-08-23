import { describe, expect, test } from 'bun:test'

import {
  apiErrorSchema,
  accountProtectionResponseSchema,
  cancelRecoveryEmailReplacementRequestSchema,
  cancelRecoveryEmailRequestSchema,
  confirmRecoveryEmailReplacementRequestSchema,
  confirmRecoveryEmailRequestSchema,
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
  completePasswordResetRequestSchema,
  passwordResetCompletionResponseSchema,
  personalDataConsentVersion,
  requestPasswordResetRequestSchema,
  requestPasswordResetResponseSchema,
  registerRequestSchema,
  recoveryEmailReplacementCommandResponseSchema,
  recoveryCodeEmailReplacementConfirmRequestSchema,
  recoveryCodeEmailReplacementConfirmResponseSchema,
  recoveryCodeEmailReplacementStartRequestSchema,
  recoveryCodeEmailReplacementStartResponseSchema,
  recoveryCodePasswordRequestSchema,
  recoveryCodeSetResponseSchema,
  recoveryCodeUseResponseSchema,
  confirmRecoveryCodeReissueRequestSchema,
  issueRecoveryCodesRequestSchema,
  startRecoveryCodeReissueRequestSchema,
  startRecoveryCodeReissueResponseSchema,
  resendRecoveryEmailReplacementRequestSchema,
  resendRecoveryEmailRequestSchema,
  startRecoveryEmailReplacementRequestSchema,
  startRecoveryEmailRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  termsVersion,
} from './index'

const validUser = {
  id: 'user_1',
  login: 'user',
  displayName: null,
  locale: 'ru' as const,
  createdAt: '2026-05-11T00:00:00.000Z',
}

describe('auth contracts', () => {
  test('requires the current legal document versions for new registration', () => {
    const staleVersion = '1.0'
    expect(personalDataConsentVersion).toBe('1.1')
    expect(termsVersion).toBe('1.1')
    expect(registerRequestSchema.safeParse({
      login: 'user',
      password: 'password123',
      privacyConsent: true,
      privacyConsentVersion: staleVersion,
      termsAccepted: true,
      termsVersion: staleVersion,
    }).success).toBe(false)
  })

  test('exposes only bounded Account Email protection states and a masked address', () => {
    expect(accountProtectionResponseSchema.parse({
      accountProtection: {
        state: 'yandex_managed',
        maskedAccountEmail: 'P***@yandex.ru',
      },
    })).toEqual({
      accountProtection: {
        state: 'yandex_managed',
        maskedAccountEmail: 'P***@yandex.ru',
      },
    })
    for (const state of ['password_unprotected', 'yandex_conflict', 'yandex_unavailable']) {
      expect(accountProtectionResponseSchema.safeParse({
        accountProtection: { state },
      }).success).toBe(true)
    }
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        state: 'yandex_managed',
        maskedAccountEmail: 'player@yandex.ru',
      },
    }).success).toBe(false)

    expect(accountProtectionResponseSchema.parse({
      accountProtection: {
        canCancel: true,
        codeExpiresAt: '2026-08-22T12:15:00.000Z',
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_pending_code',
      },
    })).toEqual({
      accountProtection: {
        canCancel: true,
        codeExpiresAt: '2026-08-22T12:15:00.000Z',
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_pending_code',
      },
    })
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        activatesAt: '2026-08-23T12:00:00.000Z',
        canCancel: false,
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_cooling_off',
      },
    }).success).toBe(true)
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        maskedAccountEmail: 'p***@mail.ru',
        recoveryCodes: 'not_issued',
        state: 'password_active',
      },
    }).success).toBe(true)
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        blockedStage: 'pending_code',
        canCancel: true,
        maskedAccountEmail: 'p***@mail.ru',
        state: 'password_service_blocked',
      },
    }).success).toBe(true)
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        canonicalKey: 'player@mail.ru',
        maskedAccountEmail: 'p***@mail.ru',
        recoveryCodes: 'not_issued',
        state: 'password_active',
      },
    }).success).toBe(false)
  })

  test('validates first Recovery Email commands without normalizing secrets in the contract', () => {
    expect(startRecoveryEmailRequestSchema.parse({
      email: ' Player@mail.ru ',
      password: 'password123',
    })).toEqual({
      email: 'Player@mail.ru',
      password: 'password123',
    })
    expect(confirmRecoveryEmailRequestSchema.parse({ code: '012345' })).toEqual({ code: '012345' })
    expect(resendRecoveryEmailRequestSchema.parse(undefined)).toEqual({})
    expect(cancelRecoveryEmailRequestSchema.parse({})).toEqual({})

    expect(startRecoveryEmailRequestSchema.safeParse({
      email: 'player@mail.ru',
      password: 'short',
    }).success).toBe(false)
    expect(confirmRecoveryEmailRequestSchema.safeParse({ code: '12345' }).success).toBe(false)
    expect(confirmRecoveryEmailRequestSchema.safeParse({ code: '123456', extra: true }).success).toBe(false)
    expect(resendRecoveryEmailRequestSchema.safeParse({ email: 'player@mail.ru' }).success).toBe(false)
  })

  test('exposes a bounded two-sided Recovery Email replacement contract', () => {
    expect(startRecoveryEmailReplacementRequestSchema.parse({
      email: ' New@mail.ru ',
      password: 'password123',
    })).toEqual({
      email: 'New@mail.ru',
      password: 'password123',
    })
    expect(resendRecoveryEmailReplacementRequestSchema.parse({ factor: 'old' })).toEqual({
      factor: 'old',
    })
    expect(confirmRecoveryEmailReplacementRequestSchema.parse({
      code: '012345',
      factor: 'new',
    })).toEqual({ code: '012345', factor: 'new' })
    expect(cancelRecoveryEmailReplacementRequestSchema.parse({})).toEqual({})
    expect(cancelRecoveryEmailReplacementRequestSchema.safeParse({ factor: 'old' }).success)
      .toBe(false)

    expect(accountProtectionResponseSchema.parse({
      accountProtection: {
        canManage: true,
        newAddress: {
          codeExpiresAt: '2026-08-22T12:15:00.000Z',
          maskedAccountEmail: 'n***@mail.ru',
          status: 'pending',
        },
        oldAddress: {
          codeExpiresAt: '2026-08-22T12:15:00.000Z',
          maskedAccountEmail: 'o***@mail.ru',
          status: 'confirmed',
        },
        state: 'password_replacing',
      },
    })).toEqual({
      accountProtection: {
        canManage: true,
        newAddress: {
          codeExpiresAt: '2026-08-22T12:15:00.000Z',
          maskedAccountEmail: 'n***@mail.ru',
          status: 'pending',
        },
        oldAddress: {
          codeExpiresAt: '2026-08-22T12:15:00.000Z',
          maskedAccountEmail: 'o***@mail.ru',
          status: 'confirmed',
        },
        state: 'password_replacing',
      },
    })
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        canManage: true,
        newAddress: {
          canonicalKey: 'new@mail.ru',
          codeExpiresAt: '2026-08-22T12:15:00.000Z',
          maskedAccountEmail: 'n***@mail.ru',
          status: 'pending',
        },
        oldAddress: {
          codeExpiresAt: '2026-08-22T12:15:00.000Z',
          maskedAccountEmail: 'o***@mail.ru',
          status: 'pending',
        },
        state: 'password_replacing',
      },
    }).success).toBe(false)
    expect(recoveryEmailReplacementCommandResponseSchema.parse({
      accountProtection: {
        maskedAccountEmail: 'n***@mail.ru',
        recoveryCodes: 'consumed',
        state: 'password_active',
      },
      replacement: {
        currentSession: 'active',
        otherSessions: 'revoked',
        status: 'completed',
      },
    }).replacement).toEqual({
      currentSession: 'active',
      otherSessions: 'revoked',
      status: 'completed',
    })

    expect(resendRecoveryEmailReplacementRequestSchema.safeParse({ factor: 'both' }).success)
      .toBe(false)
    expect(confirmRecoveryEmailReplacementRequestSchema.safeParse({
      code: '123456',
      factor: 'new',
      rawEmail: 'new@mail.ru',
    }).success).toBe(false)
  })

  test('keeps Recovery Codes bounded, one-time, and absent from normal protection reads', () => {
    const codes = Array.from(
      { length: 8 },
      (_, index) => `${index.toString(16).toUpperCase().padStart(4, '0')}-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1234`,
    )
    const issued = recoveryCodeSetResponseSchema.parse({
      accountProtection: {
        maskedAccountEmail: 'p***@mail.ru',
        recoveryCodes: 'available',
        state: 'password_active',
      },
      recoveryCodes: codes,
    })
    expect(issued.recoveryCodes).toHaveLength(8)
    expect(issueRecoveryCodesRequestSchema.parse(undefined)).toEqual({})
    expect(recoveryCodeSetResponseSchema.safeParse({
      accountProtection: {
        maskedAccountEmail: 'p***@mail.ru',
        recoveryCodes: 'available',
        state: 'password_active',
      },
      recoveryCodes: codes.slice(0, 7),
    }).success).toBe(false)
    expect(accountProtectionResponseSchema.safeParse({
      accountProtection: {
        maskedAccountEmail: 'p***@mail.ru',
        recoveryCodes: codes,
        state: 'password_active',
      },
    }).success).toBe(false)
  })

  test('validates Recovery Code reissue and non-enumerating owner recovery commands', () => {
    expect(startRecoveryCodeReissueRequestSchema.parse({ password: 'password123' }))
      .toEqual({ password: 'password123' })
    expect(confirmRecoveryCodeReissueRequestSchema.parse({ code: '012345' }))
      .toEqual({ code: '012345' })
    expect(startRecoveryCodeReissueResponseSchema.parse({
      challenge: {
        codeExpiresAt: '2026-08-22T12:15:00.000Z',
        maskedAccountEmail: 'p***@mail.ru',
      },
    }).challenge.maskedAccountEmail).toBe('p***@mail.ru')

    const unformattedCode = 'AAAA BBBB CCCC DDDD EEEE FFFF 0000 1111'
    expect(recoveryCodePasswordRequestSchema.parse({
      login: ' Owner ',
      newPassword: 'new-password123',
      recoveryCode: unformattedCode,
    })).toEqual({
      login: 'owner',
      newPassword: 'new-password123',
      recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111',
    })
    expect(recoveryCodeUseResponseSchema.parse({ outcome: 'accepted' }))
      .toEqual({ outcome: 'accepted' })
    expect(recoveryCodeUseResponseSchema.parse({ outcome: 'completed' }))
      .toEqual({ outcome: 'completed' })

    expect(recoveryCodeEmailReplacementStartRequestSchema.parse({
      email: ' New@mail.ru ',
      login: ' Owner ',
      recoveryCode: unformattedCode,
    })).toEqual({
      email: 'New@mail.ru',
      login: 'owner',
      recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000-1111',
    })
    expect(recoveryCodeEmailReplacementStartResponseSchema.parse({
      codeExpiresAt: '2026-08-22T12:15:00.000Z',
      maskedAccountEmail: 'n***@mail.ru',
      outcome: 'pending',
    }).outcome).toBe('pending')
    expect(recoveryCodeEmailReplacementStartResponseSchema.parse({ outcome: 'accepted' }))
      .toEqual({ outcome: 'accepted' })

    expect(recoveryCodeEmailReplacementConfirmRequestSchema.parse({
      code: '012345',
      login: ' Owner ',
    })).toEqual({ code: '012345', login: 'owner' })
    expect(recoveryCodeEmailReplacementConfirmResponseSchema.parse({
      activatesAt: '2026-08-23T12:00:00.000Z',
      maskedAccountEmail: 'n***@mail.ru',
      outcome: 'completed',
    }).outcome).toBe('completed')
    expect(recoveryCodeEmailReplacementConfirmResponseSchema.parse({ outcome: 'accepted' }))
      .toEqual({ outcome: 'accepted' })

    expect(recoveryCodePasswordRequestSchema.safeParse({
      login: 'owner',
      newPassword: 'new-password123',
      recoveryCode: 'AAAA-BBBB',
    }).success).toBe(false)
    expect(recoveryCodeEmailReplacementStartRequestSchema.safeParse({
      email: 'new@mail.ru',
      login: 'owner',
      recoveryCode: unformattedCode,
      ownerId: 'secret',
    }).success).toBe(false)
  })

  test('keeps email-link password recovery bounded and non-enumerating', () => {
    expect(requestPasswordResetRequestSchema.parse({ login: ' Owner ' }))
      .toEqual({ login: 'owner' })
    expect(requestPasswordResetResponseSchema.parse({ outcome: 'accepted' }))
      .toEqual({ outcome: 'accepted' })

    const token = 'A'.repeat(43)
    expect(completePasswordResetRequestSchema.parse({
      newPassword: 'new-password123',
      token,
    })).toEqual({ newPassword: 'new-password123', token })
    expect(passwordResetCompletionResponseSchema.parse({ outcome: 'completed' }))
      .toEqual({ outcome: 'completed' })
    expect(passwordResetCompletionResponseSchema.parse({ outcome: 'accepted' }))
      .toEqual({ outcome: 'accepted' })

    expect(completePasswordResetRequestSchema.safeParse({
      newPassword: 'new-password123',
      token: 'short',
    }).success).toBe(false)
    expect(completePasswordResetRequestSchema.safeParse({
      newPassword: 'new-password123',
      token,
      userId: 'must-not-be-accepted',
    }).success).toBe(false)
    expect(requestPasswordResetResponseSchema.safeParse({
      outcome: 'accepted',
      maskedEmail: 'o***@mail.ru',
    }).success).toBe(false)
  })

  test('normalizes registration and login input', () => {
    expect(
      registerRequestSchema.parse({
        login: ' USER_1 ',
        password: 'password123',
        displayName: ' Jane ',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    ).toEqual({
      login: 'user_1',
      password: 'password123',
      displayName: 'Jane',
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
    })

    expect(
      registerRequestSchema.parse({
        login: 'user',
        password: 'password123',
        displayName: '',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    ).toEqual({
      login: 'user',
      password: 'password123',
      displayName: undefined,
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
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
        privacyConsentVersion: '1.1',
        termsVersion: '1.1',
      }),
    ).toThrow()

    expect(() =>
      registerRequestSchema.parse({
        login: 'user',
        password: 'short',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsVersion: '1.1',
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
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      }),
    ).toThrow()

    // Rejects registration without a separate terms acceptance
    expect(() =>
      registerRequestSchema.parse({
        login: 'user',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: false,
        termsVersion: '1.1',
      }),
    ).toThrow()

    expect(() =>
      registerRequestSchema.parse({
        login: 'user',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: 'outdated',
        termsVersion: '1.1',
      }),
    ).toThrow()
  })

  test('limits new and updated display names to twenty characters', () => {
    const legalAcceptance = {
      privacyConsent: true as const,
      privacyConsentVersion: '1.1' as const,
      termsAccepted: true as const,
      termsVersion: '1.1' as const,
    }

    expect(registerRequestSchema.safeParse({
      ...legalAcceptance,
      login: 'user',
      password: 'password123',
      displayName: 'Я'.repeat(20),
    }).success).toBe(true)
    expect(registerRequestSchema.safeParse({
      ...legalAcceptance,
      login: 'user',
      password: 'password123',
      displayName: 'Я'.repeat(21),
    }).success).toBe(false)
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

    expect(apiErrorSchema.parse({
      error: {
        code: 'TENDER_DEADLINE_EXPIRED',
        message: 'Tender action deadline expired',
      },
    })).toMatchObject({
      error: { code: 'TENDER_DEADLINE_EXPIRED' },
    })
  })

  test('validates OAuth start request and response', () => {
    const start = oauthStartRequestSchema.parse({
      registration: {
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: true,
        termsVersion: '1.1',
      },
      webappOrigin: 'http://localhost:5173',
    })
    expect(start.webappOrigin).toBe('http://localhost:5173')
    expect(start.registration).toEqual({
      privacyConsent: true,
      privacyConsentVersion: '1.1',
      termsAccepted: true,
      termsVersion: '1.1',
    })

    // webappOrigin is optional — the backend falls back to its configured origin.
    expect(oauthStartRequestSchema.parse({}).webappOrigin).toBeUndefined()
    expect(() => oauthStartRequestSchema.parse({
      registration: {
        privacyConsent: true,
        privacyConsentVersion: 'outdated',
        termsAccepted: true,
        termsVersion: '1.1',
      },
    })).toThrow()

    expect(() => oauthStartRequestSchema.parse({ redirectUri: 'https://attacker.example/callback' })).toThrow()

    const response = oauthStartResponseSchema.parse({
      authorizationUrl: 'https://oauth.yandex.ru/authorize?state=abc',
    })
    expect(response.authorizationUrl).toContain('state=abc')
  })

  test('validates OAuth provider param', () => {
    expect(oauthProviderSchema.parse('yandex')).toBe('yandex')
    expect(() => oauthProviderSchema.parse('vk')).toThrow()
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
