import { z } from 'zod'

const booleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const antiAbuseLimitSchema = z.coerce.number().int().min(1).max(1_000_000).optional()
const antiAbuseTwoMessageLimitSchema = z.coerce.number().int().min(2).max(1_000_000).optional()

const knownWeakJwtSecrets = new Set(['replace-with-at-least-32-random-characters'])

const optionalStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().min(1).optional())

const optionalUrlSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().url().optional())

const optionalHttpHeaderNameSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed.toLowerCase()
}, z.string().regex(/^[a-z0-9!#$%&'*+.^_`|~-]+$/).optional())

const stringWithDefault = (defaultValue: string) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }, z.string().min(1).default(defaultValue))

const uuidListSchema = z
  .string()
  .default('')
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()))

const originListSchema = z
  .string()
  .default('')
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))

const analyticsCampaignListSchema = z
  .string()
  .default('')
  .transform((value) => value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))
  .pipe(z.array(z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/)).max(100))

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  API_HOST: z.ipv4().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  OPERATIONAL_METRICS_HOST: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
  OPERATIONAL_METRICS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  WORKER_HEALTH_HOST: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_USER_IDS: uuidListSchema,
  ANALYTICS_ENABLED: booleanStringSchema,
  ANALYTICS_ORIGINS: originListSchema,
  ANALYTICS_CAMPAIGN_ALLOWLIST: analyticsCampaignListSchema,
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174,http://localhost:8081,http://localhost:19006')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  WEBAPP_ORIGIN: stringWithDefault('http://localhost:5173').pipe(z.string().url()),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().nonnegative().max(60).default(10),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(90),
  SESSION_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(7),
  AUTH_BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(1024 * 1024).default(64 * 1024),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  ANTI_ABUSE_LOGIN_FAILURE_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_LOGIN_IP_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_REGISTRATION_DEVICE_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_REGISTRATION_IP_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_RECOVERY_EMAIL_MINUTE_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_RECOVERY_EMAIL_HOUR_LIMIT: antiAbuseTwoMessageLimitSchema,
  ANTI_ABUSE_RECOVERY_EMAIL_DAY_LIMIT: antiAbuseTwoMessageLimitSchema,
  ANTI_ABUSE_RECOVERY_EMAIL_IP_HOUR_LIMIT: antiAbuseTwoMessageLimitSchema,
  ANTI_ABUSE_RECOVERY_LOGIN_HOUR_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_RECOVERY_LOGIN_DAY_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_RECOVERY_LOGIN_IP_HOUR_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_RECOVERY_LOGIN_IP_DAY_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_ROOM_JOIN_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_TENDER_COMMAND_LIMIT: antiAbuseLimitSchema,
  ANTI_ABUSE_REALTIME_TICKET_LIMIT: antiAbuseLimitSchema,
  SHUTDOWN_GRACE_SECONDS: z.coerce.number().int().positive().max(60).default(20),
  TRUST_PROXY: booleanStringSchema,
  TRUSTED_PROXY_CLIENT_IP_HEADER: optionalHttpHeaderNameSchema,
  TRUSTED_PROXY_CLIENT_IP_POSITION: z.enum(['first', 'last']).optional(),
  COOKIE_SECURE: booleanStringSchema,
  MAIL_SMTP_ENABLED: booleanStringSchema,
  MAIL_SMTP_HOST: optionalStringSchema,
  MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  MAIL_SMTP_TLS_MODE: z.enum(['implicit_tls', 'starttls']).optional(),
  MAIL_SMTP_USERNAME: optionalStringSchema,
  MAIL_SMTP_PASSWORD: optionalStringSchema,
  MAIL_SMTP_FROM: optionalStringSchema,
  MAIL_SMTP_REPLY_TO: optionalStringSchema,
  MAIL_SMTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  MAIL_SMTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  MAIL_SMTP_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(3_600).default(30),
  MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  MAIL_SMTP_CIRCUIT_OPEN_SECONDS: z.coerce.number().int().min(10).max(86_400).default(300),
  MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(60),
  MAIL_SMTP_LEASE_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  MAIL_SMTP_WORKER_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  MAIL_OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
  YANDEX_OAUTH_CLIENT_ID: optionalStringSchema,
  YANDEX_OAUTH_CLIENT_SECRET: optionalStringSchema,
  OAUTH_CALLBACK_BASE_URL: optionalUrlSchema,
  YANDEX_STORAGE_REGION: optionalStringSchema,
  YANDEX_STORAGE_BUCKET: optionalStringSchema,
  YANDEX_STORAGE_ENDPOINT: optionalUrlSchema,
  YANDEX_STORAGE_CDN_BASE_URL: optionalUrlSchema,
  YANDEX_STORAGE_ACCESS_KEY_ID: optionalStringSchema,
  YANDEX_STORAGE_SECRET_ACCESS_KEY: optionalStringSchema,
  YANDEX_STORAGE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  YANDEX_STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(15 * 60),
  YANDEX_STORAGE_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(7 * 24 * 60 * 60).default(5 * 60),
  YANDEX_STORAGE_PUBLIC_CACHE_CONTROL: stringWithDefault('public, max-age=31536000, immutable'),
}).superRefine((env, ctx) => {
  validateJwtSecret(env, ctx)
  validateProductionRuntime(env, ctx)
  validateOperationalMetricsPort(env, ctx)
  validateCorsOrigins(env, ctx)
  validateWebappOrigin(env, ctx)
  validateAnalyticsEnv(env, ctx)
  validateSessionTtls(env, ctx)
  validateTrustedProxy(env, ctx)
  validateOAuth(env, ctx)
  validateStorageEnv(env, ctx)
  validateSmtpEnv(env, ctx)
})

export type AppEnv = z.infer<typeof envSchema>

export function loadEnv(source: Record<string, string | undefined>) {
  return envSchema.parse(source)
}

function validateSessionTtls(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.SESSION_ABSOLUTE_TTL_DAYS < env.REFRESH_TOKEN_TTL_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['SESSION_ABSOLUTE_TTL_DAYS'],
      message: 'SESSION_ABSOLUTE_TTL_DAYS must be at least REFRESH_TOKEN_TTL_DAYS',
    })
  }
}

function validateTrustedProxy(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.TRUST_PROXY && !env.TRUSTED_PROXY_CLIENT_IP_HEADER) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_PROXY_CLIENT_IP_HEADER'],
      message: 'TRUSTED_PROXY_CLIENT_IP_HEADER is required when TRUST_PROXY=true',
    })
  }

  if (env.TRUSTED_PROXY_CLIENT_IP_POSITION && !env.TRUSTED_PROXY_CLIENT_IP_HEADER) {
    ctx.addIssue({
      code: 'custom',
      path: ['TRUSTED_PROXY_CLIENT_IP_POSITION'],
      message: 'TRUSTED_PROXY_CLIENT_IP_POSITION requires TRUSTED_PROXY_CLIENT_IP_HEADER',
    })
  }
}

function validateJwtSecret(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!isProductionLikeRuntime(env)) return

  const invalidProductionFormat = !/^[a-fA-F0-9]{64,}$/.test(env.JWT_SECRET)
  if (isWeakJwtSecret(env.JWT_SECRET) || invalidProductionFormat) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must be a non-placeholder random secret in production',
    })
  }
}

function validateProductionRuntime(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.NODE_ENV !== 'production') return

  if (!env.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'COOKIE_SECURE must be true in production',
    })
  }
}

function validateOperationalMetricsPort(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const workerHealthPort = env.WORKER_HEALTH_PORT ?? env.PORT + 1
  if (
    env.OPERATIONAL_METRICS_PORT === env.PORT
    || env.OPERATIONAL_METRICS_PORT === workerHealthPort
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPERATIONAL_METRICS_PORT'],
      message: 'OPERATIONAL_METRICS_PORT must differ from API and worker health ports',
    })
  }
}

function isProductionLikeRuntime(env: z.infer<typeof envSchema>) {
  return env.NODE_ENV === 'production' || env.COOKIE_SECURE
}

function isWeakJwtSecret(secret: string) {
  const normalized = secret.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    knownWeakJwtSecrets.has(normalized) ||
    new Set(normalized).size === 1
  )
}

function validateCorsOrigins(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (env.CORS_ORIGINS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'CORS_ORIGINS must contain at least one allowed browser origin',
    })
    return
  }

  for (const origin of env.CORS_ORIGINS) {
    if (origin === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must not use wildcard origins when credentials are enabled',
      })
      continue
    }

    let url: URL
    try {
      url = new URL(origin)
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS contains an invalid URL: ${origin}`,
      })
      continue
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use http or https origins: ${origin}`,
      })
    }

    if (url.origin !== origin) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must contain origins only, not paths: ${origin}`,
      })
    }

    if ((env.COOKIE_SECURE || env.NODE_ENV === 'production') && url.protocol !== 'https:') {
      // Allow HTTP origins from localhost and LAN IPs when the backend is behind
      // an HTTPS tunnel (ngrok/cloudflared) — Secure cookies are set on the
      // tunnel's HTTPS domain, not the webapp origin.
      if (url.hostname === 'localhost' || isPrivateLanIp(url.hostname)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must use HTTPS when COOKIE_SECURE=true: ${origin}`,
      })
    }
  }
}

function validateWebappOrigin(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const origin = env.WEBAPP_ORIGIN
  const url = new URL(origin)
  if (!['http:', 'https:'].includes(url.protocol)) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must use http or https',
    })
  }
  if (url.origin !== origin) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must contain an origin only, not a path',
    })
  }
  if (!env.CORS_ORIGINS.includes(origin)) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must also be listed in CORS_ORIGINS',
    })
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must use HTTPS in production',
    })
  }
  if (env.COOKIE_SECURE && url.protocol !== 'https:'
    && url.hostname !== 'localhost' && !isPrivateLanIp(url.hostname)) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEBAPP_ORIGIN'],
      message: 'WEBAPP_ORIGIN must use HTTPS when COOKIE_SECURE=true',
    })
  }
}

function validateAnalyticsEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  if (!env.ANALYTICS_ENABLED) return
  if (env.ANALYTICS_ORIGINS.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANALYTICS_ORIGINS'],
      message: 'ANALYTICS_ORIGINS is required when first-party analytics is enabled',
    })
    return
  }

  for (const origin of env.ANALYTICS_ORIGINS) {
    if (origin === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['ANALYTICS_ORIGINS'],
        message: 'ANALYTICS_ORIGINS must not use wildcard origins',
      })
      continue
    }
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['ANALYTICS_ORIGINS'],
        message: `ANALYTICS_ORIGINS contains an invalid URL: ${origin}`,
      })
      continue
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANALYTICS_ORIGINS'],
        message: `ANALYTICS_ORIGINS must contain http or https origins only: ${origin}`,
      })
    }
    if ((env.COOKIE_SECURE || env.NODE_ENV === 'production') && url.protocol !== 'https:') {
      if (url.hostname === 'localhost' || isPrivateLanIp(url.hostname)) continue
      ctx.addIssue({
        code: 'custom',
        path: ['ANALYTICS_ORIGINS'],
        message: `ANALYTICS_ORIGINS must use HTTPS in production: ${origin}`,
      })
    }
  }

  if (!env.ANALYTICS_ORIGINS.includes(env.WEBAPP_ORIGIN)) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANALYTICS_ORIGINS'],
      message: 'ANALYTICS_ORIGINS must include WEBAPP_ORIGIN when analytics is enabled',
    })
  }
}

function validateStorageEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const requiredStorageKeys = [
    'YANDEX_STORAGE_REGION',
    'YANDEX_STORAGE_BUCKET',
    'YANDEX_STORAGE_ENDPOINT',
    'YANDEX_STORAGE_ACCESS_KEY_ID',
    'YANDEX_STORAGE_SECRET_ACCESS_KEY',
  ] as const
  const storageConfigured =
    requiredStorageKeys.some((key) => env[key] !== undefined) ||
    env.YANDEX_STORAGE_CDN_BASE_URL !== undefined

  if (!storageConfigured) return

  for (const key of requiredStorageKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when Yandex Object Storage is configured`,
      })
    }
  }
}

function validateOAuth(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const oauthConfigured = Boolean(env.YANDEX_OAUTH_CLIENT_ID && env.YANDEX_OAUTH_CLIENT_SECRET)
  if (!oauthConfigured) return
  if (!env.OAUTH_CALLBACK_BASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_CALLBACK_BASE_URL'],
      message: 'OAUTH_CALLBACK_BASE_URL is required when an OAuth provider is configured',
    })
    return
  }

  const callbackBaseUrl = new URL(env.OAUTH_CALLBACK_BASE_URL)
  if (callbackBaseUrl.origin !== env.OAUTH_CALLBACK_BASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_CALLBACK_BASE_URL'],
      message: 'OAUTH_CALLBACK_BASE_URL must contain an origin only, not a path',
    })
  }
  if ((env.COOKIE_SECURE || env.NODE_ENV === 'production') && callbackBaseUrl.protocol !== 'https:') {
    ctx.addIssue({
      code: 'custom',
      path: ['OAUTH_CALLBACK_BASE_URL'],
      message: 'OAUTH_CALLBACK_BASE_URL must use HTTPS in production',
    })
  }
}

function validateSmtpEnv(env: z.infer<typeof envSchema>, ctx: z.RefinementCtx) {
  const requiredSmtpKeys = [
    'MAIL_SMTP_HOST',
    'MAIL_SMTP_PORT',
    'MAIL_SMTP_TLS_MODE',
    'MAIL_SMTP_USERNAME',
    'MAIL_SMTP_PASSWORD',
    'MAIL_SMTP_FROM',
    'MAIL_SMTP_REPLY_TO',
  ] as const
  const smtpConfigured = env.MAIL_SMTP_ENABLED
    || requiredSmtpKeys.some((key) => env[key] !== undefined)
  if (!smtpConfigured) return

  for (const key of requiredSmtpKeys) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when transactional SMTP is configured`,
      })
    }
  }
  if (env.MAIL_SMTP_HOST && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(env.MAIL_SMTP_HOST)) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_SMTP_HOST'],
      message: 'MAIL_SMTP_HOST must be a DNS hostname used for TLS verification',
    })
  }
  if (env.MAIL_SMTP_FROM && env.MAIL_SMTP_FROM !== 'no-reply@anomaly-detector.ru') {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_SMTP_FROM'],
      message: 'MAIL_SMTP_FROM must use the dedicated no-reply mailbox',
    })
  }
  if (env.MAIL_SMTP_USERNAME && env.MAIL_SMTP_USERNAME !== 'no-reply@anomaly-detector.ru') {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_SMTP_USERNAME'],
      message: 'MAIL_SMTP_USERNAME must use the dedicated no-reply mailbox',
    })
  }
  if (env.MAIL_SMTP_REPLY_TO && env.MAIL_SMTP_REPLY_TO !== 'support@anomaly-detector.ru') {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_SMTP_REPLY_TO'],
      message: 'MAIL_SMTP_REPLY_TO must use the product support mailbox',
    })
  }
  if (env.MAIL_SMTP_LEASE_SECONDS * 1_000 <= env.MAIL_SMTP_TIMEOUT_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_SMTP_LEASE_SECONDS'],
      message: 'MAIL_SMTP_LEASE_SECONDS must exceed MAIL_SMTP_TIMEOUT_MS',
    })
  }
}

function isPrivateLanIp(hostname: string): boolean {
  // IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x
  const ipv4Pattern = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/
  return ipv4Pattern.test(hostname)
}
