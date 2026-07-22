import { z } from 'zod'

const displayNameSchema = z
  .union([z.string().trim().min(2).max(80), z.literal('')])
  .optional()
  .transform((value) => {
    if (value === '' || value === undefined) return undefined
    return value
  })

export const emailSchema = z.string().trim().toLowerCase().email().max(254)

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

export const localeSchema = z.union([z.literal('ru'), z.literal('en')]).default('ru')

export const userSchema = z.object({
  id: z.string(),
  email: emailSchema,
  displayName: z.string().nullable(),
  locale: localeSchema,
  createdAt: z.string().datetime(),
})

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  privacyConsent: z.literal(true),
  ageConfirmation: z.literal(true),
})

export const loginRequestSchema = z.object({
  email: emailSchema,
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

// ── OAuth ────────────────────────────────────────────────────────────────────

export const oauthProviderSchema = z.union([z.literal('yandex'), z.literal('vk')])

export const oauthStartRequestSchema = z.object({
  redirectUri: z.string().url().max(512).optional(),
  webappOrigin: z.string().url().max(512).optional(),
})

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
export type CookieRefreshRequest = z.infer<typeof cookieRefreshRequestSchema>
export type CookieLogoutRequest = z.infer<typeof cookieLogoutRequestSchema>
export type TokenRefreshRequest = z.infer<typeof tokenRefreshRequestSchema>
export type TokenLogoutRequest = z.infer<typeof tokenLogoutRequestSchema>
export type CookieAuthResponse = z.infer<typeof cookieAuthResponseSchema>
export type TokenAuthResponse = z.infer<typeof tokenAuthResponseSchema>
export type CookieRefreshResponse = z.infer<typeof cookieRefreshResponseSchema>
export type TokenRefreshResponse = z.infer<typeof tokenRefreshResponseSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
export type OAuthProviderId = z.infer<typeof oauthProviderSchema>
export type OAuthStartRequest = z.infer<typeof oauthStartRequestSchema>
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>