import { z } from 'zod'

export const displayNameMinLength = 2
export const displayNameMaxLength = 20

const displayNameSchema = z
  .union([
    z.string().trim().min(displayNameMinLength).max(displayNameMaxLength),
    z.literal(''),
  ])
  .optional()
  .transform((value) => {
    if (value === '' || value === undefined) return undefined
    return value
  })

export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Login may contain lowercase letters, digits, underscores, and hyphens')

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

export const localeSchema = z.union([z.literal('ru'), z.literal('en')]).default('ru')

export const personalDataConsentVersion = '1.0' as const
export const termsVersion = '1.0' as const

const registrationLegalAcceptanceSchema = z.object({
  privacyConsent: z.literal(true),
  privacyConsentVersion: z.literal(personalDataConsentVersion),
  termsAccepted: z.literal(true),
  termsVersion: z.literal(termsVersion),
})

export const userSchema = z.object({
  id: z.string(),
  login: loginSchema,
  displayName: z.string().nullable(),
  locale: localeSchema,
  createdAt: z.string().datetime(),
})

export const registerRequestSchema = registrationLegalAcceptanceSchema.extend({
  login: loginSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
})

export const loginRequestSchema = z.object({
  login: loginSchema,
  password: passwordSchema,
})

export const cookieRefreshRequestSchema = z.object({}).strict().optional().default({})
export const cookieLogoutRequestSchema = z.object({}).strict().optional().default({})

export const tokenRefreshRequestSchema = z.object({
  refreshToken: z.string().min(32),
})

export const tokenLogoutRequestSchema = tokenRefreshRequestSchema

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  locale: localeSchema.optional(),
})

export const cookieAuthResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
}).strict()

export const tokenAuthResponseSchema = cookieAuthResponseSchema.extend({
  refreshToken: z.string(),
})

export const cookieRefreshResponseSchema = z.object({
  accessToken: z.string(),
}).strict()

export const tokenRefreshResponseSchema = cookieRefreshResponseSchema.extend({
  refreshToken: z.string(),
})

export const meResponseSchema = z.object({
  user: userSchema,
})

const maskedAccountEmailSchema = z
  .string()
  .min(7)
  .max(254)
  .regex(/^[^@\s]\*{3}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/)

const recoveryEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .refine((value) => {
    const separator = value.indexOf('@')
    return separator > 0 && separator === value.lastIndexOf('@') && separator < value.length - 1
  }, 'Recovery Email must contain one address separator')

export const startRecoveryEmailRequestSchema = z.object({
  email: recoveryEmailSchema,
  password: passwordSchema,
}).strict()

export const resendRecoveryEmailRequestSchema = z.object({}).strict().optional().default({})

export const confirmRecoveryEmailRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
}).strict()

export const cancelRecoveryEmailRequestSchema = z.object({}).strict().optional().default({})

export const recoveryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-F0-9]{32}$/))
  .transform((value) => value.match(/.{4}/g)!.join('-'))

export const issueRecoveryCodesRequestSchema = z.object({}).strict().optional().default({})

export const startRecoveryCodeReissueRequestSchema = z.object({
  password: passwordSchema,
}).strict()

export const confirmRecoveryCodeReissueRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
}).strict()

export const recoveryCodePasswordRequestSchema = z.object({
  login: loginSchema,
  newPassword: passwordSchema,
  recoveryCode: recoveryCodeSchema,
}).strict()

export const recoveryCodeEmailReplacementStartRequestSchema = z.object({
  email: recoveryEmailSchema,
  login: loginSchema,
  recoveryCode: recoveryCodeSchema,
}).strict()

export const recoveryCodeEmailReplacementConfirmRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  login: loginSchema,
}).strict()

const recoveryEmailReplacementFactorSchema = z.enum(['old', 'new'])

export const startRecoveryEmailReplacementRequestSchema = z.object({
  email: recoveryEmailSchema,
  password: passwordSchema,
}).strict()

export const resendRecoveryEmailReplacementRequestSchema = z.object({
  factor: recoveryEmailReplacementFactorSchema,
}).strict()

export const confirmRecoveryEmailReplacementRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  factor: recoveryEmailReplacementFactorSchema,
}).strict()

export const cancelRecoveryEmailReplacementRequestSchema = z.object({})
  .strict()
  .optional()
  .default({})

const recoveryEmailReplacementAddressSchema = z.object({
  codeExpiresAt: z.string().datetime(),
  maskedAccountEmail: maskedAccountEmailSchema,
  status: z.enum(['pending', 'confirmed', 'expired', 'service_blocked']),
}).strict()

export const accountProtectionSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('password_unprotected') }).strict(),
  z.object({
    canCancel: z.boolean(),
    codeExpiresAt: z.string().datetime(),
    maskedAccountEmail: maskedAccountEmailSchema,
    state: z.literal('password_pending_code'),
  }).strict(),
  z.object({
    activatesAt: z.string().datetime(),
    canCancel: z.boolean(),
    maskedAccountEmail: maskedAccountEmailSchema,
    state: z.literal('password_cooling_off'),
  }).strict(),
  z.object({
    maskedAccountEmail: maskedAccountEmailSchema,
    recoveryCodes: z.enum(['not_issued', 'available', 'consumed']),
    state: z.literal('password_active'),
  }).strict(),
  z.object({
    canManage: z.boolean(),
    newAddress: recoveryEmailReplacementAddressSchema,
    oldAddress: recoveryEmailReplacementAddressSchema,
    state: z.literal('password_replacing'),
  }).strict(),
  z.object({
    blockedStage: z.enum(['pending_code', 'cooling_off', 'active']),
    canCancel: z.boolean(),
    maskedAccountEmail: maskedAccountEmailSchema,
    state: z.literal('password_service_blocked'),
  }).strict(),
  z.object({
    state: z.literal('yandex_managed'),
    maskedAccountEmail: maskedAccountEmailSchema,
  }).strict(),
  z.object({ state: z.literal('yandex_conflict') }).strict(),
  z.object({ state: z.literal('yandex_unavailable') }).strict(),
])

export const accountProtectionResponseSchema = z.object({
  accountProtection: accountProtectionSchema,
}).strict()

export const recoveryEmailReplacementCommandResponseSchema = accountProtectionResponseSchema.extend({
  replacement: z.object({
    currentSession: z.literal('active'),
    otherSessions: z.enum(['unchanged', 'revoked']),
    status: z.enum(['pending', 'completed']),
  }).strict(),
}).strict()

export const recoveryCodeSetResponseSchema = accountProtectionResponseSchema.extend({
  recoveryCodes: z.array(recoveryCodeSchema).length(8),
}).strict()

export const startRecoveryCodeReissueResponseSchema = z.object({
  challenge: z.object({
    codeExpiresAt: z.string().datetime(),
    maskedAccountEmail: maskedAccountEmailSchema,
  }).strict(),
}).strict()

export const recoveryCodeUseResponseSchema = z.object({
  outcome: z.enum(['accepted', 'completed']),
}).strict()

export const recoveryCodeEmailReplacementStartResponseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('accepted') }).strict(),
  z.object({
    codeExpiresAt: z.string().datetime(),
    maskedAccountEmail: maskedAccountEmailSchema,
    outcome: z.literal('pending'),
  }).strict(),
])

export const recoveryCodeEmailReplacementConfirmResponseSchema = z.discriminatedUnion(
  'outcome',
  [
    z.object({ outcome: z.literal('accepted') }).strict(),
    z.object({
      activatesAt: z.string().datetime(),
      maskedAccountEmail: maskedAccountEmailSchema,
      outcome: z.literal('completed'),
    }).strict(),
  ],
)

// ── OAuth ────────────────────────────────────────────────────────────────────

export const oauthProviderSchema = z.literal('yandex')

export const oauthStartRequestSchema = z.object({
  registration: registrationLegalAcceptanceSchema.optional(),
  webappOrigin: z.string().url().max(512).optional(),
}).strict()

export const oauthStartResponseSchema = z.object({
  authorizationUrl: z.string(),
})

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().min(1).optional(),
  error_description: z.string().optional(),
}).refine(
  (q) => q.code !== undefined || q.error !== undefined,
  { message: 'Either code or error must be provided' },
)

// ── Type exports ─────────────────────────────────────────────────────────────

export type UserDto = z.infer<typeof userSchema>
export type RegisterRequest = z.input<typeof registerRequestSchema>
export type RegisterPayload = z.output<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type UpdateProfileRequest = z.input<typeof updateProfileSchema>
export type UpdateProfilePayload = z.output<typeof updateProfileSchema>
export type CookieRefreshRequest = z.infer<typeof cookieRefreshRequestSchema>
export type CookieLogoutRequest = z.infer<typeof cookieLogoutRequestSchema>
export type TokenRefreshRequest = z.infer<typeof tokenRefreshRequestSchema>
export type TokenLogoutRequest = z.infer<typeof tokenLogoutRequestSchema>
export type CookieAuthResponse = z.infer<typeof cookieAuthResponseSchema>
export type TokenAuthResponse = z.infer<typeof tokenAuthResponseSchema>
export type CookieRefreshResponse = z.infer<typeof cookieRefreshResponseSchema>
export type TokenRefreshResponse = z.infer<typeof tokenRefreshResponseSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
export type AccountProtection = z.infer<typeof accountProtectionSchema>
export type AccountProtectionResponse = z.infer<typeof accountProtectionResponseSchema>
export type StartRecoveryEmailRequest = z.infer<typeof startRecoveryEmailRequestSchema>
export type ConfirmRecoveryEmailRequest = z.infer<typeof confirmRecoveryEmailRequestSchema>
export type StartRecoveryEmailReplacementRequest = z.infer<
  typeof startRecoveryEmailReplacementRequestSchema
>
export type ResendRecoveryEmailReplacementRequest = z.infer<
  typeof resendRecoveryEmailReplacementRequestSchema
>
export type ConfirmRecoveryEmailReplacementRequest = z.infer<
  typeof confirmRecoveryEmailReplacementRequestSchema
>
export type CancelRecoveryEmailReplacementRequest = z.infer<
  typeof cancelRecoveryEmailReplacementRequestSchema
>
export type ConfirmRecoveryCodeReissueRequest = z.infer<
  typeof confirmRecoveryCodeReissueRequestSchema
>
export type RecoveryCodeEmailReplacementConfirmRequest = z.infer<
  typeof recoveryCodeEmailReplacementConfirmRequestSchema
>
export type RecoveryCodeEmailReplacementConfirmResponse = z.infer<
  typeof recoveryCodeEmailReplacementConfirmResponseSchema
>
export type RecoveryCodeEmailReplacementStartRequest = z.infer<
  typeof recoveryCodeEmailReplacementStartRequestSchema
>
export type RecoveryCodeEmailReplacementStartResponse = z.infer<
  typeof recoveryCodeEmailReplacementStartResponseSchema
>
export type RecoveryCodePasswordRequest = z.infer<typeof recoveryCodePasswordRequestSchema>
export type RecoveryCodeSetResponse = z.infer<typeof recoveryCodeSetResponseSchema>
export type RecoveryCodeUseResponse = z.infer<typeof recoveryCodeUseResponseSchema>
export type StartRecoveryCodeReissueRequest = z.infer<
  typeof startRecoveryCodeReissueRequestSchema
>
export type StartRecoveryCodeReissueResponse = z.infer<
  typeof startRecoveryCodeReissueResponseSchema
>
export type RecoveryEmailReplacementCommandResponse = z.infer<
  typeof recoveryEmailReplacementCommandResponseSchema
>
export type OAuthProviderId = z.infer<typeof oauthProviderSchema>
export type OAuthStartRequest = z.infer<typeof oauthStartRequestSchema>
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>
