import { z } from 'zod'

const displayNameSchema = z
  .union([z.string().trim().min(2).max(80), z.literal('')])
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

export const userSchema = z.object({
  id: z.string(),
  login: loginSchema,
  displayName: z.string().nullable(),
  locale: localeSchema,
  createdAt: z.string().datetime(),
})

export const registerRequestSchema = z.object({
  login: loginSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  privacyConsent: z.literal(true),
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

// ── OAuth ────────────────────────────────────────────────────────────────────

export const oauthProviderSchema = z.union([z.literal('yandex'), z.literal('vk')])

export const oauthStartRequestSchema = z.object({
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
export type OAuthProviderId = z.infer<typeof oauthProviderSchema>
export type OAuthStartRequest = z.infer<typeof oauthStartRequestSchema>
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>
