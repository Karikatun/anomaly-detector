import { describe, expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import { createApp } from '../../../app'
import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import type { AuthService } from '../application/auth-service'
import { AuthFailure } from '../domain/errors'
import { toAuthAppError } from './errors'
import type { AuthHttpEnv } from './middleware'
import { createAuthRoutes, oauthCallbackErrorCode } from './routes'

const env: AppEnv = {
  API_HOST: '0.0.0.0',
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
  JWT_SECRET: 'test-route-secret-at-least-thirty-two-chars-123',
  ADMIN_USER_IDS: [],
  ANALYTICS_ENABLED: false,
  ANALYTICS_ORIGINS: [],
  ANALYTICS_CAMPAIGN_ALLOWLIST: [],
  CORS_ORIGINS: ['https://ops.example.com', 'https://web.example.com'],
  WEBAPP_ORIGIN: 'https://web.example.com',
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  SESSION_ABSOLUTE_TTL_DAYS: 90,
  SESSION_RETENTION_DAYS: 7,
  AUTH_BODY_LIMIT_BYTES: 64 * 1024,
  AUTH_RATE_LIMIT_MAX: 60,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHUTDOWN_GRACE_SECONDS: 20,
  TRUST_PROXY: true,
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
  COOKIE_SECURE: true,
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

describe('auth routes', () => {
  test('allows the configured trusted client IP header only for the browser E2E runtime', async () => {
    const app = createApp({
      env: {
        ...env,
        NODE_ENV: 'test',
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-e2e-client-ip',
      },
      prisma: {} as DbClient,
    })
    const response = await app.request('/api/auth/register', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://web.example.com',
        'Access-Control-Request-Headers': 'content-type,x-e2e-client-ip',
        'Access-Control-Request-Method': 'POST',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-headers')).toContain('x-e2e-client-ip')

    const productionResponse = await createApp({ env, prisma: {} as DbClient }).request('/api/auth/register', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://web.example.com',
        'Access-Control-Request-Headers': 'content-type,x-untrusted-client-ip',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(productionResponse.headers.get('access-control-allow-headers')).not.toContain('x-untrusted-client-ip')
  })

  test('uses a stable callback code when OAuth registration needs legal consent', () => {
    const failure = new AuthFailure(
      'oauth_registration_consent_required',
      'localized message must not become a client contract',
    )
    expect(oauthCallbackErrorCode(failure)).toBe('oauth_registration_consent_required')
    expect(oauthCallbackErrorCode(toAuthAppError(failure))).toBe('oauth_registration_consent_required')
    expect(oauthCallbackErrorCode(new Error('provider failed'))).toBe('oauth_failed')
  })

  test('conceals an occupied email behind the generic OAuth callback failure', () => {
    const failure = new AuthFailure(
      'oauth_account_email_conflict',
      'message must not disclose the other account',
    )
    expect(oauthCallbackErrorCode(toAuthAppError(failure))).toBe('oauth_failed')
  })

  test('limits auth request bodies before validation or password work', async () => {
    const app = createApp({ env: { ...env, AUTH_BODY_LIMIT_BYTES: 32 }, prisma: {} as DbClient })
    const response = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'body', password: 'x'.repeat(64) }),
    })

    expect(response.status).toBe(413)
  })

  test('rejects registration when terms acceptance is not affirmative', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const response = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        login: 'legal-user',
        password: 'password123',
        privacyConsent: true,
        privacyConsentVersion: '1.1',
        termsAccepted: false,
        termsVersion: '1.1',
      }),
    })

    expect(response.status).toBe(400)
  })

  test('rate limits repeated auth writes from one client before service work', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = () => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.8',
      },
      body: JSON.stringify({ login: 'invalid', password: 'short' }),
    })

    expect((await request()).status).toBe(400)
    const limited = await request()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })

  test('uses the first trusted proxy address instead of the shared ingress address', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = (clientIp: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `${clientIp}, 10.10.0.8`,
      },
      body: JSON.stringify({ login: 'invalid', password: 'short' }),
    })

    expect((await request('203.0.113.10')).status).toBe(400)
    expect((await request('203.0.113.11')).status).toBe(400)
    expect((await request('203.0.113.10')).status).toBe(429)
  })

  test('can select the trusted last address from an appended proxy chain', async () => {
    const app = createApp({
      env: {
        ...env,
        AUTH_RATE_LIMIT_MAX: 1,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
        TRUSTED_PROXY_CLIENT_IP_POSITION: 'last',
      },
      prisma: {} as DbClient,
    })
    const request = (clientIp: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.99, ${clientIp}`,
      },
      body: JSON.stringify({ login: 'invalid', password: 'short' }),
    })

    expect((await request('203.0.113.10')).status).toBe(400)
    expect((await request('203.0.113.11')).status).toBe(400)
    expect((await request('203.0.113.10')).status).toBe(429)
  })

  test('rejects all secure cookie auth writes from untrusted origins before auth service work', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const refreshCookie = `anomaly_detector_refresh=${'r'.repeat(32)}`

    const untrustedLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ login: 'user', password: 'password123' }),
    })
    const untrustedLoginBody = await untrustedLogin.json()

    expect(untrustedLogin.status).toBe(403)
    expect(untrustedLoginBody.error.code).toBe('FORBIDDEN')

    const noOriginRefresh = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: refreshCookie,
      },
      body: JSON.stringify({}),
    })
    const noOriginRefreshBody = await noOriginRefresh.json()

    expect(noOriginRefresh.status).toBe(403)
    expect(noOriginRefreshBody.error.code).toBe('FORBIDDEN')

    const untrustedLogout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: refreshCookie,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    })
    const untrustedLogoutBody = await untrustedLogout.json()

    expect(untrustedLogout.status).toBe(403)
    expect(untrustedLogoutBody.error.code).toBe('FORBIDDEN')
  })

  test('rejects untrusted OAuth return origins and caller-provided callback URLs', async () => {
    const app = createApp({ env, prisma: {} as DbClient })

    const untrustedOrigin = await app.request('/api/auth/oauth/yandex/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webappOrigin: 'https://attacker.example' }),
    })
    expect(untrustedOrigin.status).toBe(403)
    expect((await untrustedOrigin.json()).error.code).toBe('FORBIDDEN')

    const nonPlayerCorsOrigin = await app.request('/api/auth/oauth/yandex/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webappOrigin: 'https://ops.example.com' }),
    })
    expect(nonPlayerCorsOrigin.status).toBe(403)
    expect((await nonPlayerCorsOrigin.json()).error.code).toBe('FORBIDDEN')

    const callerProvidedCallback = await app.request('/api/auth/oauth/yandex/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri: 'https://attacker.example/callback' }),
    })
    expect(callerProvidedCallback.status).toBe(400)
    expect((await callerProvidedCallback.json()).error.code).toBe('VALIDATION_ERROR')
  })

  test('returns OAuth provider errors to the configured player origin', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const response = await app.request(
      '/api/auth/oauth/yandex/callback?error=access_denied&error_description=cancelled&state=state-123',
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://web.example.com/?auth_error=cancelled',
    )
  })

  test.each([
    'https://app.anomaly-detector.ru',
    'https://anomaly-detector.ru',
  ])('returns a successful OAuth callback and host-only secure cookie to %s', async (webappUrl) => {
    let completionCalls = 0
    const routes = oauthRoutes(webappUrl, async () => {
      completionCalls += 1
      return {
        created: true,
        refreshToken: 'mock-refresh-token',
        webappOrigin: webappUrl,
      }
    })
    const response = await routes.request(
      `/oauth/yandex/callback?code=mock-code&state=${encodeURIComponent(oauthState(webappUrl))}`,
    )

    expect(completionCalls).toBe(1)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${webappUrl}/?analytics_registration=1`)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('anomaly_detector_refresh=mock-refresh-token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=None')
    expect(cookie).toContain('Path=/api/auth')
    expect(cookie).not.toMatch(/(?:^|;)\s*Domain=/i)
  })

  test('rejects an in-flight OAuth return from the previous split origin before side effects', async () => {
    let completionCalls = 0
    const currentOrigin = 'https://anomaly-detector.ru'
    const routes = oauthRoutes(currentOrigin, async () => {
      completionCalls += 1
      throw new Error('stale-origin completion must not run')
    })
    const staleState = oauthState('https://app.anomaly-detector.ru')
    const response = await routes.request(
      `/oauth/yandex/callback?code=mock-code&state=${encodeURIComponent(staleState)}`,
    )

    expect(completionCalls).toBe(0)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      `${currentOrigin}/?auth_error=oauth_failed`,
    )
  })
})

function oauthState(webappOrigin: string) {
  return `${Buffer.from(webappOrigin).toString('base64url')}::mock-state`
}

function oauthRoutes(
  webappUrl: string,
  completeOAuthSignIn: () => Promise<{
    created: boolean
    refreshToken: string
    webappOrigin: string
  }>,
) {
  const passThrough = (async (_context, next) => {
    await next()
  }) as MiddlewareHandler<AuthHttpEnv>
  const service = { completeOAuthSignIn } as unknown as AuthService

  return createAuthRoutes({
    authenticatedMutationBudget: passThrough,
    deviceTokens: {
      resolve: () => ({ cookieValue: null, deviceId: 'unused-test-device' }),
    },
    env,
    oauthCallbackBaseUrl: 'https://api.anomaly-detector.ru',
    requireAuth: passThrough,
    service,
    webappUrl,
  })
}
