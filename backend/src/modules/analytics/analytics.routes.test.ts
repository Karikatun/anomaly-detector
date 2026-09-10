import { expect, test } from 'bun:test'

import type { AnalyticsStore } from './application/ports'
import { createAnalyticsRoutes } from './transport/routes'
import { AppError } from '../../http/errors'

const expiresAt = new Date('2026-09-22T12:00:00.000Z')
const token = 'A'.repeat(43)

test('records an unlinkable landing view and classifies known crawlers without request identity', async () => {
  let received: unknown
  const routes = createAnalyticsRoutes({
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    cookieSecure: false,
    store: fakeStore({ recordLandingView: async (input) => { received = input } }),
  })

  const response = await routes.request('/events/landing', {
    body: JSON.stringify({ campaign: null, referrerDomain: 'example.org' }),
    headers: { Origin: 'https://anomaly-detector.ru',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 compatible; OAI-SearchBot/1.0',
      'X-Forwarded-For': '203.0.113.10',
    },
    method: 'POST',
  })

  expect(response.status).toBe(204)
  expect(received).toEqual({
    campaign: null,
    referrerDomain: 'example.org',
    trafficClass: 'known_bot',
  })
  expect(response.headers.get('set-cookie')).toBeNull()
})

test('creates the first cross-surface identifier only after affirmative consent', async () => {
  let received: unknown
  const routes = createAnalyticsRoutes({
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    cookieSecure: true,
    store: fakeStore({
      grant: async (input) => {
        received = input
        return { expiresAt, token }
      },
    }),
  })

  const response = await routes.request('/consent/allow', {
    body: JSON.stringify({
      campaign: 'launch_ru',
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      referrerDomain: null,
    }),
    headers: { Origin: 'https://anomaly-detector.ru',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    method: 'POST',
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ expiresAt: expiresAt.toISOString(), mode: 'allowed' })
  expect(received).toEqual({
    campaign: 'launch_ru',
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
    referrerDomain: null,
    trafficClass: 'human',
  })
  const cookie = response.headers.getSetCookie().join('; ')
  expect(cookie).toContain('anomaly_detector_analytics_journey=')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Max-Age=2592000')
  expect(cookie).toContain('Path=/api/analytics')
  expect(cookie).toContain('SameSite=Lax')
  expect(cookie).toContain('Secure')
})

test('remembers necessary-only choice without a unique value and revokes existing raw journey data', async () => {
  let revoked: string | undefined
  const routes = createAnalyticsRoutes({
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    cookieSecure: false,
    store: fakeStore({ revoke: async (value) => { revoked = value; return true } }),
  })

  const response = await routes.request('/consent/necessary', {
    headers: { Origin: 'https://anomaly-detector.ru', Cookie: `anomaly_detector_analytics_journey=${token}` },
    method: 'POST',
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ expiresAt: null, mode: 'necessary' })
  expect(revoked).toBe(token)
  const cookie = response.headers.getSetCookie().join('; ')
  expect(cookie).toContain('anomaly_detector_analytics_choice=necessary')
  expect(cookie).toContain('anomaly_detector_analytics_journey=')
  expect(cookie).toContain('Max-Age=0')
})

test('silently ignores linked events when no consent cookie exists', async () => {
  let called = false
  const routes = createAnalyticsRoutes({
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    cookieSecure: false,
    store: fakeStore({ recordEvent: async () => { called = true; return true } }),
  })

  const response = await routes.request('/events', {
    body: JSON.stringify({ event: 'registration_complete' }),
    headers: { Origin: 'https://anomaly-detector.ru', 'Content-Type': 'application/json' },
    method: 'POST',
  })

  expect(response.status).toBe(204)
  expect(called).toBe(false)
})

test('reports only allowed, necessary or undecided status without exposing the journey token', async () => {
  const routes = createAnalyticsRoutes({
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    cookieSecure: false,
    store: fakeStore({
      status: async () => ({ expiresAt: expiresAt.toISOString(), mode: 'allowed' }),
    }),
  })

  const allowed = await routes.request('/consent/status', {
    headers: { Origin: 'https://anomaly-detector.ru', Cookie: `anomaly_detector_analytics_journey=${token}` },
  })
  const necessary = await routes.request('/consent/status', {
    headers: { Origin: 'https://anomaly-detector.ru', Cookie: 'anomaly_detector_analytics_choice=necessary' },
  })
  const undecided = await routes.request('/consent/status', { headers: { Origin: 'https://anomaly-detector.ru' } })

  expect(await allowed.json()).toEqual({ expiresAt: expiresAt.toISOString(), mode: 'allowed' })
  expect(await necessary.json()).toEqual({ expiresAt: null, mode: 'necessary' })
  expect(await undecided.json()).toEqual({ expiresAt: null, mode: 'undecided' })
  expect(JSON.stringify(await (await routes.request('/consent/status', {
    headers: { Origin: 'https://anomaly-detector.ru', Cookie: `anomaly_detector_analytics_journey=${token}` },
  })).json())).not.toContain(token)
})

test('rejects untrusted analytics origins before any budget, persistence or cookie work', async () => {
  let calls = 0
  const touched = async () => { calls++; return false }
  const routes = createAnalyticsRoutes({
    cookieSecure: true,
    origins: new Set(['https://anomaly-detector.ru', 'https://app.anomaly-detector.ru']),
    checkBudget: async () => { calls++; return { allowed: true, retryAfterSeconds: 1 } },
    store: fakeStore({
      grant: async () => { calls++; return { expiresAt, token } },
      recordEvent: touched,
      recordLandingView: async () => { calls++ },
      revoke: touched,
    }),
  })
  routes.onError((error, context) => context.json({ error: true }, error instanceof AppError ? error.status : 500))
  for (const origin of [undefined, 'null', 'https://outsider.example', 'https://untrusted.anomaly-detector.ru']) {
    for (const [path, body] of [
      ['/events/landing', { campaign: null, referrerDomain: null }],
      ['/events', { event: 'tutorial_cta' }],
      ['/consent/allow', { campaign: null, commandId: crypto.randomUUID(), referrerDomain: null }],
      ['/consent/revoke', {}],
    ] as const) {
      const response = await routes.request(path, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'text/plain', ...(origin ? { Origin: origin } : {}), Cookie: `anomaly_detector_analytics_journey=${token}` },
        method: 'POST',
      })
      expect(response.status).toBe(403)
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  }
  expect(calls).toBe(0)
})

test('limits ingestion but always permits a trusted visitor to withdraw consent', async () => {
  let writes = 0
  let revocations = 0
  const routes = createAnalyticsRoutes({
    cookieSecure: true,
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: false, retryAfterSeconds: 17 }),
    store: fakeStore({
      recordLandingView: async () => { writes++ },
      revoke: async () => { revocations++; return true },
    }),
  })
  routes.onError((error, context) => context.json({ error: true }, error instanceof AppError ? error.status : 500))
  const headers = { Origin: 'https://anomaly-detector.ru', Cookie: `anomaly_detector_analytics_journey=${token}` }
  const limited = await routes.request('/events/landing', {
    body: JSON.stringify({ campaign: null, referrerDomain: null }), headers, method: 'POST',
  })
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBe('17')
  expect(writes).toBe(0)
  const withdrawn = await routes.request('/consent/revoke', { headers, method: 'POST' })
  expect(withdrawn.status).toBe(200)
  expect(revocations).toBe(1)
})

test('aggregate mode counts a click without reading cookies and has no consent or linked event routes', async () => {
  let received: unknown
  let linkedCalls = 0
  const routes = createAnalyticsRoutes({
    cookieSecure: true,
    origins: new Set(['https://anomaly-detector.ru']),
    checkBudget: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    mode: 'aggregate',
    store: fakeStore({
      recordAggregateEvent: async (value) => { received = value },
      status: async () => { linkedCalls++; return { expiresAt: null, mode: 'undecided' } },
      grant: async () => { linkedCalls++; return { expiresAt, token } },
      recordEvent: async () => { linkedCalls++; return true },
    }),
  })
  const headers = { Origin: 'https://anomaly-detector.ru', Cookie: `anomaly_detector_analytics_journey=${token}` }
  const response = await routes.request('/events/aggregate', {
    headers, method: 'POST', body: JSON.stringify({ event: 'tutorial_cta', campaign: 'ad_01', referrerDomain: null }),
  })
  expect(response.status).toBe(204)
  expect(response.headers.get('set-cookie')).toBeNull()
  expect(received).toEqual({ event: 'tutorial_cta', campaign: 'ad_01', referrerDomain: null, trafficClass: 'human' })
  for (const path of ['/consent/allow', '/consent/necessary', '/consent/revoke', '/events']) {
    const unavailable = await routes.request(path, { headers, method: 'POST', body: '{}' })
    expect(unavailable.status).toBe(404)
    expect(unavailable.headers.get('set-cookie')).toBeNull()
  }
  expect((await routes.request('/consent/status', { headers })).status).toBe(404)
  expect(linkedCalls).toBe(0)
})

function fakeStore(overrides: Partial<AnalyticsStore> = {}): AnalyticsStore {
  return {
    cleanup: async () => ({ aggregates: 0, journeys: 0 }),
    grant: async () => ({ expiresAt, token }),
    readOverview: async () => ({
      botLandingViews: 0,
      campaigns: [],
      mode: 'consented',
      daily: [],
      generatedAt: '2026-08-23T12:00:00.000Z',
      sources: [],
      steps: [],
      transitions: [],
      windowDays: 30,
    }),
    recordEvent: async () => false,
    recordAggregateEvent: async () => undefined,
    recordLandingView: async () => undefined,
    revoke: async () => false,
    status: async () => ({ expiresAt: null, mode: 'undecided' }),
    ...overrides,
  }
}
