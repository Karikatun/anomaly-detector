import { describe, expect, test } from 'bun:test'

import { createApp } from '../../../app'
import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import { AuthFailure } from '../domain/errors'
import { oauthCallbackErrorCode } from './routes'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
  JWT_SECRET: 'test-route-secret-at-least-thirty-two-chars-123',
  ADMIN_USER_IDS: [],
  CORS_ORIGINS: ['https://web.example.com'],
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
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
  COOKIE_SECURE: true,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
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
        'Access-Control-Request-Headers': 'content-type,do-connecting-ip',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(productionResponse.headers.get('access-control-allow-headers')).not.toContain('do-connecting-ip')
  })

  test('uses a stable callback code when OAuth registration needs legal consent', () => {
    expect(oauthCallbackErrorCode(new AuthFailure(
      'oauth_registration_consent_required',
      'localized message must not become a client contract',
    ))).toBe('oauth_registration_consent_required')
    expect(oauthCallbackErrorCode(new Error('provider failed'))).toBe('oauth_failed')
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

  test('rate limits repeated auth writes from one client before service work', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = () => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.8',
        'Do-Connecting-Ip': '203.0.113.10',
      },
      body: JSON.stringify({ login: 'invalid', password: 'short' }),
    })

    expect((await request()).status).toBe(400)
    const limited = await request()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })

  test('uses the configured trusted proxy header instead of a shared ingress address', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = (clientIp: string) => app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.10.0.8',
        'Do-Connecting-Ip': clientIp,
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

    const callerProvidedCallback = await app.request('/api/auth/oauth/yandex/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri: 'https://attacker.example/callback' }),
    })
    expect(callerProvidedCallback.status).toBe(400)
    expect((await callerProvidedCallback.json()).error.code).toBe('VALIDATION_ERROR')
  })
})
