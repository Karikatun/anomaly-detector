import { afterEach, expect, test } from 'bun:test'
import { createServer } from 'node:net'

import { composeEnv, e2eBackendEnv, preferredBackendPort } from '../e2e/env'
import { applyE2ePortEnv, resolveE2ePorts, type PortPlan } from '../e2e/ports'
import { portFromUrl } from '../e2e/url'

const envKeys = [
  'COMPOSE_PROJECT_NAME',
  'DATABASE_URL',
  'E2E_BACKEND_PORT',
  'E2E_BACKEND_URL',
  'E2E_EDGE_PORT',
  'E2E_EDGE_URL',
  'E2E_WEB_PORT',
  'E2E_WEB_URL',
  'E2E_WEBSITE_PORT',
  'E2E_WEBSITE_URL',
  'JWT_SECRET',
  'OPERATIONAL_METRICS_PORT',
  'POSTGRES_TEST_PORT',
  'TEST_DATABASE_URL',
  'WORKER_HEALTH_PORT',
] as const

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

test('composeEnv derives the docker compose port from the resolved test database url', () => {
  process.env.POSTGRES_TEST_PORT = '54331'

  const env = composeEnv({
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public',
    TEST_DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public',
    POSTGRES_TEST_PORT: '54331',
  })

  expect(env.POSTGRES_TEST_PORT).toBe('54330')
})

test('e2eBackendEnv gives API and worker processes one valid JWT secret', () => {
  delete process.env.JWT_SECRET

  const env = e2eBackendEnv()

  expect(env.JWT_SECRET).toBe('web-e2e-secret-at-least-thirty-two-characters')
})

test('e2eBackendEnv keeps auth rate limiting out of the browser smoke-test budget', () => {
  const env = e2eBackendEnv()

  expect(env.AUTH_RATE_LIMIT_MAX).toBe('1000')
})

test('e2eBackendEnv disables SMTP even when the caller has it enabled', () => {
  const env = e2eBackendEnv({ MAIL_SMTP_ENABLED: 'true' })

  expect(env.MAIL_SMTP_ENABLED).toBe('false')
})

test('e2eBackendEnv preserves an explicitly configured JWT secret', () => {
  process.env.JWT_SECRET = 'explicit-web-e2e-secret-at-least-thirty-two-chars'

  const env = e2eBackendEnv()

  expect(env.JWT_SECRET).toBe(process.env.JWT_SECRET)
})

test('e2eBackendEnv permits an explicit secure-cookie OAuth profile', () => {
  const env = e2eBackendEnv({
    COOKIE_SECURE: 'true',
    YANDEX_OAUTH_CLIENT_ID: 'split-domain-client',
    YANDEX_OAUTH_CLIENT_SECRET: 'split-domain-secret',
  })

  expect(env.COOKIE_SECURE).toBe('true')
  expect(env.YANDEX_OAUTH_CLIENT_ID).toBe('split-domain-client')
  expect(env.YANDEX_OAUTH_CLIENT_SECRET).toBe('split-domain-secret')
})

test('portFromUrl handles postgres aliases and defaults', () => {
  expect(
    portFromUrl('postgres://superuser:superpassword@localhost/anomaly_detector_test?schema=public'),
  ).toBe('5432')
  expect(
    portFromUrl('postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public'),
  ).toBe('5432')
  expect(portFromUrl('https://example.com')).toBe('443')
})

test('composeEnv defaults a portless postgres URL to the postgres default port', () => {
  process.env.POSTGRES_TEST_PORT = '54331'

  const env = composeEnv({
    DATABASE_URL: 'postgres://superuser:superpassword@localhost/anomaly_detector_test?schema=public',
    TEST_DATABASE_URL: 'postgres://superuser:superpassword@localhost/anomaly_detector_test?schema=public',
    POSTGRES_TEST_PORT: '54331',
  })

  expect(env.POSTGRES_TEST_PORT).toBe('5432')
})

test('composeEnv defaults a portless postgresql URL to the postgres default port', () => {
  process.env.POSTGRES_TEST_PORT = '54331'

  const env = composeEnv({
    DATABASE_URL: 'postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public',
    TEST_DATABASE_URL: 'postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public',
    POSTGRES_TEST_PORT: '54331',
  })

  expect(env.POSTGRES_TEST_PORT).toBe('5432')
})

test('resolveE2ePorts defaults a portless postgres URL alias to the postgres default port', async () => {
  process.env.TEST_DATABASE_URL = 'postgres://superuser:superpassword@localhost/anomaly_detector_test?schema=public'
  process.env.POSTGRES_TEST_PORT = '54331'
  process.env.E2E_BACKEND_PORT = '50001'
  process.env.E2E_WEB_PORT = '55001'
  process.env.E2E_WEBSITE_PORT = '60001'

  const plan = await resolveE2ePorts()

  expect(plan.postgresTestPort).toBe(5432)
  expect(plan.databaseUrl).toBe('postgres://superuser:superpassword@localhost/anomaly_detector_test?schema=public')
})

test('resolveE2ePorts defaults a portless postgresql URL to the postgres default port', async () => {
  process.env.TEST_DATABASE_URL = 'postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public'
  process.env.POSTGRES_TEST_PORT = '54331'
  process.env.E2E_BACKEND_PORT = '50001'
  process.env.E2E_WEB_PORT = '55001'
  process.env.E2E_WEBSITE_PORT = '60001'

  const plan = await resolveE2ePorts()

  expect(plan.postgresTestPort).toBe(5432)
  expect(plan.databaseUrl).toBe('postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public')
})

test('resolveE2ePorts reserves a distinct public website origin', async () => {
  process.env.TEST_DATABASE_URL = 'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public'
  process.env.E2E_BACKEND_PORT = '50001'
  process.env.E2E_WEB_PORT = '55001'
  process.env.E2E_WEBSITE_PORT = '60001'

  const plan = await resolveE2ePorts()

  expect(plan.websitePort).toBe(60001)
  expect(plan.websiteUrl).toBe('http://127.0.0.1:60001')
  expect(plan.websiteUrl).not.toBe(plan.webUrl)
})

test('resolveE2ePorts selects a free three-port backend runtime block', async () => {
  delete process.env.E2E_BACKEND_PORT
  delete process.env.E2E_BACKEND_URL
  process.env.TEST_DATABASE_URL =
    'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public'
  process.env.E2E_WEB_PORT = '55001'
  process.env.E2E_WEBSITE_PORT = '60001'

  await assertPortCanBeReserved(preferredBackendPort)
  const occupiedWorkerPort = createServer()
  await new Promise<void>((resolve, reject) => {
    occupiedWorkerPort.once('error', reject)
    occupiedWorkerPort.listen(
      { host: '127.0.0.1', port: preferredBackendPort + 1 },
      resolve,
    )
  })

  try {
    const plan = await resolveE2ePorts()

    expect(plan.backendPort).toBeGreaterThan(preferredBackendPort)
    expect(plan.workerHealthPort).toBe(plan.backendPort + 1)
    expect(plan.operationalMetricsPort).toBe(plan.backendPort + 2)
  } finally {
    await new Promise<void>((resolve, reject) => {
      occupiedWorkerPort.close((error) => error ? reject(error) : resolve())
    })
  }
})

test('resolveE2ePorts rejects an explicit backend port without room for runtime listeners', async () => {
  delete process.env.E2E_BACKEND_URL
  process.env.E2E_BACKEND_PORT = '65534'
  process.env.TEST_DATABASE_URL =
    'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public'
  process.env.E2E_WEB_PORT = '55001'
  process.env.E2E_WEBSITE_PORT = '60001'

  await expect(resolveE2ePorts()).rejects.toThrow(
    'E2E_BACKEND_PORT must reserve three consecutive TCP ports',
  )
})

test('resolveE2ePorts rejects an explicit backend URL without room for runtime listeners', async () => {
  process.env.E2E_BACKEND_URL = 'http://127.0.0.1:65534'
  delete process.env.E2E_BACKEND_PORT
  process.env.TEST_DATABASE_URL =
    'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public'
  process.env.E2E_WEB_PORT = '55001'
  process.env.E2E_WEBSITE_PORT = '60001'

  await expect(resolveE2ePorts()).rejects.toThrow(
    'E2E_BACKEND_URL must reserve three consecutive TCP ports',
  )
})

test('applyE2ePortEnv overwrites a stale postgres test port with the planned port', () => {
  const plan: PortPlan = {
    backendPort: 50001,
    backendUrl: 'http://127.0.0.1:50001',
    databaseUrl: 'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public',
    edgePort: 64001,
    edgeUrl: 'http://127.0.0.1:64001',
    operationalMetricsPort: 50003,
    postgresTestPort: 54330,
    webPort: 55001,
    webUrl: 'http://127.0.0.1:55001',
    workerHealthPort: 50002,
    websitePort: 60001,
    websiteUrl: 'http://127.0.0.1:60001',
  }

  process.env.E2E_BACKEND_PORT = '3000'
  process.env.OPERATIONAL_METRICS_PORT = '3002'
  process.env.POSTGRES_TEST_PORT = '54331'
  process.env.WORKER_HEALTH_PORT = '3001'

  applyE2ePortEnv(plan)

  expect(process.env.E2E_BACKEND_PORT).toBe('50001')
  expect(process.env.OPERATIONAL_METRICS_PORT).toBe('50003')
  expect(process.env.POSTGRES_TEST_PORT).toBe('54330')
  expect(process.env.TEST_DATABASE_URL).toBe(plan.databaseUrl)
  expect(process.env.DATABASE_URL).toBe(plan.databaseUrl)
  expect(process.env.WORKER_HEALTH_PORT).toBe('50002')
  expect(process.env.E2E_WEBSITE_URL).toBe(plan.websiteUrl)
  expect(process.env.E2E_EDGE_URL).toBe(plan.edgeUrl)
})

async function assertPortCanBeReserved(port: number) {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, resolve)
  })
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
