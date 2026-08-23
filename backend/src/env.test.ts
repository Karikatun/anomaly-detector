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
    expect(env.ANALYTICS_ENABLED).toBe(false)
    expect(env.ANALYTICS_ORIGINS).toEqual([])
    expect(env.ANALYTICS_CAMPAIGN_ALLOWLIST).toEqual([])
    expect(env.ADMIN_USER_IDS).toEqual([])
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:8081'])
    expect(env.WEBAPP_ORIGIN).toBe('http://localhost:5173')
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

  test('enables transactional SMTP only with a complete protected configuration', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '12345678901234567890123456789012',
    }
    expect(loadEnv(baseEnv).MAIL_SMTP_ENABLED).toBe(false)
    expect(() => loadEnv({
      ...baseEnv,
      MAIL_SMTP_ENABLED: 'true',
      MAIL_SMTP_HOST: 'smtp.example.ru',
    })).toThrow('MAIL_SMTP_USERNAME')
    expect(() => loadEnv({
      ...baseEnv,
      MAIL_SMTP_ENABLED: 'true',
      MAIL_SMTP_FROM: 'no-reply@anomaly-detector.ru',
      MAIL_SMTP_HOST: 'smtp.example.ru',
      MAIL_SMTP_PASSWORD: 'smtp-password-must-not-leak',
      MAIL_SMTP_PORT: '465',
      MAIL_SMTP_REPLY_TO: 'support@anomaly-detector.ru',
      MAIL_SMTP_TLS_MODE: 'plain',
      MAIL_SMTP_USERNAME: 'no-reply@anomaly-detector.ru',
    })).toThrow('MAIL_SMTP_TLS_MODE')
    expect(() => loadEnv({
      ...baseEnv,
      MAIL_SMTP_ENABLED: 'true',
      MAIL_SMTP_FROM: 'no-reply@anomaly-detector.ru',
      MAIL_SMTP_HOST: 'smtp.example.ru',
      MAIL_SMTP_LEASE_SECONDS: '60',
      MAIL_SMTP_PASSWORD: 'smtp-password-must-not-leak',
      MAIL_SMTP_PORT: '465',
      MAIL_SMTP_REPLY_TO: 'support@anomaly-detector.ru',
      MAIL_SMTP_TIMEOUT_MS: '60000',
      MAIL_SMTP_TLS_MODE: 'implicit_tls',
      MAIL_SMTP_USERNAME: 'no-reply@anomaly-detector.ru',
    })).toThrow('MAIL_SMTP_LEASE_SECONDS')
    expect(() => loadEnv({
      ...baseEnv,
      MAIL_OUTBOX_RETENTION_DAYS: '31',
    })).toThrow('MAIL_OUTBOX_RETENTION_DAYS')

    const env = loadEnv({
      ...baseEnv,
      MAIL_SMTP_ENABLED: 'true',
      MAIL_SMTP_FROM: 'no-reply@anomaly-detector.ru',
      MAIL_SMTP_HOST: 'smtp.example.ru',
      MAIL_SMTP_PASSWORD: 'smtp-password-must-not-leak',
      MAIL_SMTP_PORT: '465',
      MAIL_SMTP_REPLY_TO: 'support@anomaly-detector.ru',
      MAIL_SMTP_TLS_MODE: 'implicit_tls',
      MAIL_SMTP_USERNAME: 'no-reply@anomaly-detector.ru',
    })
    expect(env.MAIL_SMTP_ENABLED).toBe(true)
    expect(env.MAIL_SMTP_TLS_MODE).toBe('implicit_tls')
    expect(env.MAIL_SMTP_MAX_ATTEMPTS).toBe(5)
    expect(env.MAIL_OUTBOX_RETENTION_DAYS).toBe(30)
  })

  test('allows both local browser clients by default', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '12345678901234567890123456789012',
    })

    expect(env.CORS_ORIGINS).toContain('http://localhost:5173')
    expect(env.CORS_ORIGINS).toContain('http://localhost:5174')
  })

  test('enables first-party analytics only for explicit bounded origins and campaigns', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '12345678901234567890123456789012',
      CORS_ORIGINS: 'http://localhost:5173',
      WEBAPP_ORIGIN: 'http://localhost:5173',
    }

    expect(() => loadEnv({ ...baseEnv, ANALYTICS_ENABLED: 'true' }))
      .toThrow('ANALYTICS_ORIGINS')
    expect(() => loadEnv({
      ...baseEnv,
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_ORIGINS: '*,http://localhost:5173',
    })).toThrow('ANALYTICS_ORIGINS')
    expect(() => loadEnv({
      ...baseEnv,
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_ORIGINS: 'http://localhost:5174',
    })).toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({
      ...baseEnv,
      ANALYTICS_CAMPAIGN_ALLOWLIST: 'launch_ru,contains@email',
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
    })).toThrow('ANALYTICS_CAMPAIGN_ALLOWLIST')

    const env = loadEnv({
      ...baseEnv,
      ANALYTICS_CAMPAIGN_ALLOWLIST: 'launch_ru, PARTNER-1',
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_ORIGINS: 'http://localhost:5174,http://localhost:5173',
    })
    expect(env.ANALYTICS_ENABLED).toBe(true)
    expect(env.ANALYTICS_ORIGINS).toEqual([
      'http://localhost:5174',
      'http://localhost:5173',
    ])
    expect(env.ANALYTICS_CAMPAIGN_ALLOWLIST).toEqual(['launch_ru', 'partner-1'])
  })

  test('requires HTTPS analytics origins in production', () => {
    const productionBase = {
      ANALYTICS_ENABLED: 'true',
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://app.example.com',
      DATABASE_URL: 'postgresql://localhost/test',
      JWT_SECRET: '01'.repeat(32),
      NODE_ENV: 'production',
      WEBAPP_ORIGIN: 'https://app.example.com',
    }

    expect(() => loadEnv({
      ...productionBase,
      ANALYTICS_ORIGINS: 'https://app.example.com,http://public.example.com',
    })).toThrow('ANALYTICS_ORIGINS')
    expect(() => loadEnv({
      ...productionBase,
      ANALYTICS_ORIGINS: 'https://app.example.com,https://public.example.com',
    })).not.toThrow()
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
      WEBAPP_ORIGIN: 'https://web.example.com',
    }

    expect(() => loadEnv(productionBase)).not.toThrow()
    expect(() => loadEnv({ ...productionBase, JWT_SECRET: 'a-memorable-human-secret-phrase-that-is-long-enough-to-pass' }))
      .toThrow('JWT_SECRET')
    expect(() => loadEnv({ ...productionBase, COOKIE_SECURE: 'false' })).toThrow('COOKIE_SECURE')
    expect(() => loadEnv({ ...productionBase, CORS_ORIGINS: 'http://web.example.com' }))
      .toThrow('CORS_ORIGINS')
  })

  test('requires one explicit trusted player origin in production-like runtimes', () => {
    const productionBase = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
      JWT_SECRET: '01'.repeat(32),
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://ops.example.com,https://app.example.com',
    }

    expect(() => loadEnv(productionBase)).toThrow('WEBAPP_ORIGIN')

    const env = loadEnv({
      ...productionBase,
      WEBAPP_ORIGIN: 'https://app.example.com',
    })
    expect(env.WEBAPP_ORIGIN).toBe('https://app.example.com')

    expect(() => loadEnv({
      ...productionBase,
      WEBAPP_ORIGIN: 'https://app.example.com/tutorial',
    })).toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({
      ...productionBase,
      WEBAPP_ORIGIN: 'https://public.example.com',
    })).toThrow('WEBAPP_ORIGIN')
    expect(() => loadEnv({
      ...productionBase,
      WEBAPP_ORIGIN: 'http://app.example.com',
    })).toThrow('WEBAPP_ORIGIN')
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
