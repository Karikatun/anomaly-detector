import { describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'

import type { AppEnv } from '../../../env'
import { signAccessToken, verifyAccessToken } from './access-tokens'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
  JWT_SECRET: '12345678901234567890123456789012',
  ADMIN_USER_IDS: [],
  ANALYTICS_ENABLED: false,
  ANALYTICS_ORIGINS: [],
  ANALYTICS_CAMPAIGN_ALLOWLIST: [],
  CORS_ORIGINS: ['http://localhost:5173'],
  WEBAPP_ORIGIN: 'http://localhost:5173',
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  SESSION_ABSOLUTE_TTL_DAYS: 90,
  SESSION_RETENTION_DAYS: 7,
  AUTH_BODY_LIMIT_BYTES: 64 * 1024,
  AUTH_RATE_LIMIT_MAX: 60,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHUTDOWN_GRACE_SECONDS: 20,
  TRUST_PROXY: false,
  COOKIE_SECURE: false,
  MAIL_SMTP_ENABLED: false,
  MAIL_SMTP_TIMEOUT_MS: 10_000,
  MAIL_SMTP_MAX_ATTEMPTS: 5,
  MAIL_SMTP_RETRY_BASE_SECONDS: 30,
  MAIL_SMTP_CIRCUIT_FAILURE_THRESHOLD: 5,
  MAIL_SMTP_CIRCUIT_OPEN_SECONDS: 300,
  MAIL_SMTP_DELIVERY_BUDGET_PER_MINUTE: 60,
  MAIL_SMTP_LEASE_SECONDS: 60,
  MAIL_SMTP_WORKER_INTERVAL_MS: 1_000,
  MAIL_OUTBOX_RETENTION_DAYS: 30,
  YANDEX_STORAGE_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  YANDEX_STORAGE_UPLOAD_URL_TTL_SECONDS: 900,
  YANDEX_STORAGE_DOWNLOAD_URL_TTL_SECONDS: 300,
  YANDEX_STORAGE_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
}

describe('access tokens', () => {
  test('signs and verifies session-scoped JWT payloads', async () => {
    const token = await signAccessToken(
      {
        sub: 'user_1',
        sessionId: 'session_1',
        login: 'user',
      },
      env,
    )

    await expect(verifyAccessToken(token, env)).resolves.toEqual({
      sub: 'user_1',
      sessionId: 'session_1',
      login: 'user',
    })
  })

  test('rejects JWTs signed with any algorithm except HS256', async () => {
    const token = await new SignJWT({
      sessionId: 'session_1',
      login: 'user',
    })
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('user_1')
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode(env.JWT_SECRET))

    await expect(verifyAccessToken(token, env)).rejects.toThrow()
  })
})
