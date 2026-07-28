import { expect, test } from 'bun:test'

import type { DbClient } from './db'
import { loadEnv } from './env'
import { createApp } from './app'
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
