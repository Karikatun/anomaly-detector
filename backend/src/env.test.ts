import { describe, expect, test } from 'bun:test'

import { loadEnv } from './env'

describe('loadEnv', () => {
  test('parses defaults and comma-separated origins', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '12345678901234567890123456789012',
      CORS_ORIGINS: 'http://localhost:5173, http://localhost:8081',
    })

    expect(env.PORT).toBe(3000)
    expect(env.WORKER_HEALTH_PORT).toBeUndefined()
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900)
    expect(env.REFRESH_REUSE_GRACE_SECONDS).toBe(10)
    expect(env.SESSION_ABSOLUTE_TTL_DAYS).toBe(90)
    expect(env.COOKIE_SECURE).toBe(false)
    expect(env.ADMIN_USER_IDS).toEqual([])
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:8081'])
    expect(env.YANDEX_STORAGE_REGION).toBeUndefined()
    expect(env.YANDEX_STORAGE_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(env.YANDEX_STORAGE_UPLOAD_URL_TTL_SECONDS).toBe(900)
    expect(env.YANDEX_STORAGE_DOWNLOAD_URL_TTL_SECONDS).toBe(300)
    expect(env.YANDEX_STORAGE_PUBLIC_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
  })

  test('parses and validates the administrator UUID allowlist', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(loadEnv({
      ...baseEnv,
      ADMIN_USER_IDS: '019f8099-7e26-7760-ad08-66d1d66b2718, 019f8099-7e26-7760-ad08-66d1d66b2719',
    }).ADMIN_USER_IDS).toEqual([
      '019f8099-7e26-7760-ad08-66d1d66b2718',
      '019f8099-7e26-7760-ad08-66d1d66b2719',
    ])

    expect(() => loadEnv({ ...baseEnv, ADMIN_USER_IDS: 'operator' })).toThrow('ADMIN_USER_IDS')
  })

  test('accepts a dedicated worker health port', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '12345678901234567890123456789012',
      WORKER_HEALTH_PORT: '3001',
    })

    expect(env.WORKER_HEALTH_PORT).toBe(3001)
  })

  test('allows both local browser clients by default', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '12345678901234567890123456789012',
    })

    expect(env.CORS_ORIGINS).toContain('http://localhost:5173')
    expect(env.CORS_ORIGINS).toContain('http://localhost:5174')
  })

  test('requires complete Yandex Object Storage configuration when storage is enabled', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: '12345678901234567890123456789012',
        YANDEX_STORAGE_BUCKET: 'uploads',
      }),
    ).toThrow()
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: '12345678901234567890123456789012',
        YANDEX_STORAGE_CDN_BASE_URL: 'https://images.example.com',
      }),
    ).toThrow()

    const env = loadEnv({
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '12345678901234567890123456789012',
      YANDEX_STORAGE_REGION: 'ru-central1',
      YANDEX_STORAGE_BUCKET: 'uploads',
      YANDEX_STORAGE_ENDPOINT: 'https://storage.yandexcloud.net',
      YANDEX_STORAGE_CDN_BASE_URL: 'https://images.example.com',
      YANDEX_STORAGE_ACCESS_KEY_ID: 'access-key',
      YANDEX_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    })

    expect(env.YANDEX_STORAGE_REGION).toBe('ru-central1')
    expect(env.YANDEX_STORAGE_BUCKET).toBe('uploads')
    expect(env.YANDEX_STORAGE_CDN_BASE_URL).toBe('https://images.example.com')
  })

  test('rejects known weak JWT secrets in production-like runtimes', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')

    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass',
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'https://web.example.com',
      }),
    ).toThrow('JWT_SECRET')
  })

  test('requires generated secrets, secure cookies, and HTTPS origins in production', () => {
    const productionBase = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://web.example.com',
    }

    expect(() => loadEnv(productionBase)).not.toThrow()
    expect(() => loadEnv({ ...productionBase, JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass' }))
      .toThrow('JWT_SECRET')
    expect(() => loadEnv({ ...productionBase, COOKIE_SECURE: 'false' })).toThrow('COOKIE_SECURE')
    expect(() => loadEnv({ ...productionBase, CORS_ORIGINS: 'http://web.example.com' }))
      .toThrow('CORS_ORIGINS')
  })

  test('rejects unsafe production CORS origins', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '12345678901234567890123456789012',
    }

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: '*',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        CORS_ORIGINS: 'https://web.example.com/path',
      }),
    ).toThrow('CORS_ORIGINS')

    expect(() =>
      loadEnv({
        ...baseEnv,
        COOKIE_SECURE: 'true',
        CORS_ORIGINS: 'http://web.example.com',
      }),
    ).toThrow('CORS_ORIGINS')
  })

  test('keeps absolute session lifetime at least as long as refresh lifetime', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: '12345678901234567890123456789012',
        REFRESH_TOKEN_TTL_DAYS: '30',
        SESSION_ABSOLUTE_TTL_DAYS: '29',
      }),
    ).toThrow('SESSION_ABSOLUTE_TTL_DAYS')
  })

  test('bounds refresh replay tolerance to a short window', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
        JWT_SECRET: '12345678901234567890123456789012',
        REFRESH_REUSE_GRACE_SECONDS: '61',
      }),
    ).toThrow('REFRESH_REUSE_GRACE_SECONDS')
  })

  test('requires an explicit client IP header when a trusted proxy is enabled', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '12345678901234567890123456789012',
      TRUST_PROXY: 'true',
    }

    expect(() => loadEnv(baseEnv)).toThrow('TRUSTED_PROXY_CLIENT_IP_HEADER')
    expect(() =>
      loadEnv({
        ...baseEnv,
        TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-forwarded-for',
      }),
    ).not.toThrow()
  })

  test('requires a fixed public callback origin when OAuth is enabled', () => {
    const oauthEnv = {
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '12345678901234567890123456789012',
      YANDEX_OAUTH_CLIENT_ID: 'client-id',
      YANDEX_OAUTH_CLIENT_SECRET: 'client-secret',
    }

    expect(() => loadEnv(oauthEnv)).toThrow('OAUTH_CALLBACK_BASE_URL')
    expect(() => loadEnv({ ...oauthEnv, OAUTH_CALLBACK_BASE_URL: 'https://api.example.com/path' }))
      .toThrow('OAUTH_CALLBACK_BASE_URL')
    expect(() => loadEnv({ ...oauthEnv, OAUTH_CALLBACK_BASE_URL: 'https://api.example.com' })).not.toThrow()
  })
})
