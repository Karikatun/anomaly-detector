import { expect, test } from 'bun:test'

import type { DbClient } from './db'
import { loadEnv } from './env'
import { createApp } from './app'
import { createOperationalMetrics } from './operational-metrics'
import type { SecurityEvent } from './security/events'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/anomaly_detector',
  JWT_SECRET: '12345678901234567890123456789012',
})

test('liveness is process-only while readiness checks the database', async () => {
  let databaseAvailable = true
  const prisma = {
    $queryRaw: async () => {
      if (!databaseAvailable) throw new Error('database unavailable')
      return [{ '?column?': 1 }]
    },
  } as unknown as DbClient
  const app = createApp({ env, prisma })

  expect((await app.request('/health/live')).status).toBe(200)
  expect((await app.request('/health/ready')).status).toBe(200)

  databaseAvailable = false

  expect((await app.request('/health/live')).status).toBe(200)
  expect((await app.request('/health/ready')).status).toBe(503)
})

test('keeps metrics off the public API while the private collector observes API outcomes', async () => {
  const times = [1_000, 1_125, 1_250]
  const operationalMetrics = createOperationalMetrics({ now: () => times.shift() ?? 1_250 })
  const app = createApp({
    env,
    operationalMetrics,
    prisma: { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient,
  })

  const publicMetrics = await app.request('/metrics')
  const missingApiRoute = await app.request('/api/not-a-real-route')
  const privateMetrics = await operationalMetrics.fetch(new Request('http://collector/metrics'))
  const body = await privateMetrics.text()

  expect(publicMetrics.status).toBe(404)
  expect(missingApiRoute.status).toBe(404)
  expect(privateMetrics.status).toBe(200)
  expect(body).toContain('anomaly_detector_api_requests_total{status_class="4xx"} 1')
  expect(body).toContain('anomaly_detector_api_request_duration_seconds_sum 0.125')
})

test('CORS preflight allows the standard mutation methods exposed by the client transport', async () => {
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient
  const app = createApp({ env, prisma })
  const response = await app.request('/api/future-resource', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'PATCH',
    },
  })

  expect(response.status).toBe(204)
  expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
  expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
})

test('limits the public landing origin to the analytics path and keeps analytics disabled by default', async () => {
  const prisma = { $queryRaw: async () => [{ '?column?': 1 }] } as unknown as DbClient
  const analyticsEnv = loadEnv({
    ANALYTICS_ENABLED: 'true',
    ANALYTICS_ORIGINS: 'http://localhost:5173,http://localhost:4321',
    CORS_ORIGINS: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://localhost/test',
    JWT_SECRET: '12345678901234567890123456789012',
    WEBAPP_ORIGIN: 'http://localhost:5173',
  })
  const app = createApp({ env: analyticsEnv, prisma })

  const analyticsPreflight = await app.request('/api/analytics/events/landing', {
    headers: {
      'Access-Control-Request-Method': 'POST',
      Origin: 'http://localhost:4321',
    },
    method: 'OPTIONS',
  })
  const authPreflight = await app.request('/api/auth/login', {
    headers: {
      'Access-Control-Request-Method': 'POST',
      Origin: 'http://localhost:4321',
    },
    method: 'OPTIONS',
  })

  expect(analyticsPreflight.headers.get('access-control-allow-origin')).toBe('http://localhost:4321')
  expect(analyticsPreflight.headers.get('access-control-allow-credentials')).toBe('true')
  expect(authPreflight.headers.get('access-control-allow-origin')).toBeNull()
  expect((await createApp({ env, prisma }).request('/api/analytics/consent/status')).status).toBe(404)
})

test('limits request bodies for non-authenticated product routes before route validation', async () => {
  const events: SecurityEvent[] = []
  const app = createApp({
    env: { ...env, AUTH_BODY_LIMIT_BYTES: 32 },
    prisma: {} as DbClient,
    securityEvents: { emit: (event) => { events.push(event) } },
  })
  const response = await app.request('/api/tenders/not-a-tender/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ padding: 'x'.repeat(64) }),
  })

  expect(response.status).toBe(413)
  expect(await response.json()).toEqual({
    error: {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    },
  })
  expect(response.headers.get('x-request-id')).toBeTruthy()
  expect(events).toEqual([
    expect.objectContaining({
      code: 'PAYLOAD_TOO_LARGE',
      method: 'POST',
      outcome: 'limited',
      path: '/api/tenders/not-a-tender/commands',
      type: 'request_rejected',
    }),
  ])
})

test('records authentication denials as structured security events', async () => {
  const events: SecurityEvent[] = []
  const app = createApp({
    env,
    prisma: {} as DbClient,
    securityEvents: { emit: (event) => { events.push(event) } },
  })
  const response = await app.request('/api/auth/me')

  expect(response.status).toBe(401)
  expect(events).toEqual([
    expect.objectContaining({
      code: 'UNAUTHORIZED',
      method: 'GET',
      outcome: 'denied',
      path: '/api/auth/me',
      requestId: response.headers.get('x-request-id'),
      type: 'authentication_rejected',
    }),
  ])
})

test('conceals and records denied operator access without publishing the route', async () => {
  const events: SecurityEvent[] = []
  const app = createApp({
    env,
    prisma: {} as DbClient,
    securityEvents: { emit: (event) => { events.push(event) } },
  })

  const response = await app.request('/api/operations/overview')
  const openApi = await (await app.request('/openapi.json')).text()

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  })
  expect(openApi).not.toContain('/api/operations')
  expect(events).toEqual([
    expect.objectContaining({
      code: 'NOT_FOUND',
      outcome: 'denied',
      path: '/api/operations/overview',
      reason: 'operations_access_concealed',
      type: 'authentication_rejected',
    }),
  ])
})
