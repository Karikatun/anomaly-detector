import { afterEach, expect, test } from 'bun:test'

import { composeEnv, e2eBackendEnv } from '../e2e/env'
import { applyE2ePortEnv, resolveE2ePorts, type PortPlan } from '../e2e/ports'
import { portFromUrl } from '../e2e/url'

const envKeys = [
  'COMPOSE_PROJECT_NAME',
  'DATABASE_URL',
  'E2E_BACKEND_PORT',
  'E2E_BACKEND_URL',
  'E2E_WEB_PORT',
  'E2E_WEB_URL',
  'JWT_SECRET',
  'POSTGRES_TEST_PORT',
  'TEST_DATABASE_URL',
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

test('e2eBackendEnv preserves an explicitly configured JWT secret', () => {
  process.env.JWT_SECRET = 'explicit-web-e2e-secret-at-least-thirty-two-chars'

  const env = e2eBackendEnv()

  expect(env.JWT_SECRET).toBe(process.env.JWT_SECRET)
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

  const plan = await resolveE2ePorts()

  expect(plan.postgresTestPort).toBe(5432)
  expect(plan.databaseUrl).toBe('postgres://superuser:superpassword@localhost/anomaly_detector_test?schema=public')
})

test('resolveE2ePorts defaults a portless postgresql URL to the postgres default port', async () => {
  process.env.TEST_DATABASE_URL = 'postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public'
  process.env.POSTGRES_TEST_PORT = '54331'
  process.env.E2E_BACKEND_PORT = '50001'
  process.env.E2E_WEB_PORT = '55001'

  const plan = await resolveE2ePorts()

  expect(plan.postgresTestPort).toBe(5432)
  expect(plan.databaseUrl).toBe('postgresql://superuser:superpassword@localhost/anomaly_detector_test?schema=public')
})

test('applyE2ePortEnv overwrites a stale postgres test port with the planned port', () => {
  const plan: PortPlan = {
    backendPort: 50001,
    backendUrl: 'http://127.0.0.1:50001',
    databaseUrl: 'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public',
    postgresTestPort: 54330,
    webPort: 55001,
    webUrl: 'http://127.0.0.1:55001',
  }

  process.env.POSTGRES_TEST_PORT = '54331'

  applyE2ePortEnv(plan)

  expect(process.env.POSTGRES_TEST_PORT).toBe('54330')
  expect(process.env.TEST_DATABASE_URL).toBe(plan.databaseUrl)
  expect(process.env.DATABASE_URL).toBe(plan.databaseUrl)
})
