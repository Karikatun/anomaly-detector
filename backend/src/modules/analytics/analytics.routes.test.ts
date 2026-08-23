import { expect, test } from 'bun:test'

import type { AnalyticsStore } from './application/ports'
import { createAnalyticsRoutes } from './transport/routes'

const expiresAt = new Date('2026-09-22T12:00:00.000Z')
const token = 'A'.repeat(43)

test('records an unlinkable landing view and classifies known crawlers without request identity', async () => {
  let received: unknown
  const routes = createAnalyticsRoutes({
    cookieSecure: false,
    store: fakeStore({ recordLandingView: async (input) => { received = input } }),
  })

  const response = await routes.request('/events/landing', {
    body: JSON.stringify({ campaign: null, referrerDomain: 'example.org' }),
    headers: {
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
    headers: {
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
    cookieSecure: false,
    store: fakeStore({ revoke: async (value) => { revoked = value; return true } }),
  })

  const response = await routes.request('/consent/necessary', {
    headers: { Cookie: `anomaly_detector_analytics_journey=${token}` },
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
    cookieSecure: false,
    store: fakeStore({ recordEvent: async () => { called = true; return true } }),
  })

  const response = await routes.request('/events', {
    body: JSON.stringify({ event: 'registration_complete' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  expect(response.status).toBe(204)
  expect(called).toBe(false)
})

test('reports only allowed, necessary or undecided status without exposing the journey token', async () => {
  const routes = createAnalyticsRoutes({
    cookieSecure: false,
    store: fakeStore({
      status: async () => ({ expiresAt: expiresAt.toISOString(), mode: 'allowed' }),
    }),
  })

  const allowed = await routes.request('/consent/status', {
    headers: { Cookie: `anomaly_detector_analytics_journey=${token}` },
  })
  const necessary = await routes.request('/consent/status', {
    headers: { Cookie: 'anomaly_detector_analytics_choice=necessary' },
  })
  const undecided = await routes.request('/consent/status')

  expect(await allowed.json()).toEqual({ expiresAt: expiresAt.toISOString(), mode: 'allowed' })
  expect(await necessary.json()).toEqual({ expiresAt: null, mode: 'necessary' })
  expect(await undecided.json()).toEqual({ expiresAt: null, mode: 'undecided' })
  expect(JSON.stringify(await (await routes.request('/consent/status', {
    headers: { Cookie: `anomaly_detector_analytics_journey=${token}` },
  })).json())).not.toContain(token)
})

function fakeStore(overrides: Partial<AnalyticsStore> = {}): AnalyticsStore {
  return {
    cleanup: async () => ({ aggregates: 0, journeys: 0 }),
    grant: async () => ({ expiresAt, token }),
    readOverview: async () => ({
      botLandingViews: 0,
      daily: [],
      generatedAt: '2026-08-23T12:00:00.000Z',
      sources: [],
      steps: [],
      transitions: [],
      windowDays: 30,
    }),
    recordEvent: async () => false,
    recordLandingView: async () => undefined,
    revoke: async () => false,
    status: async () => ({ expiresAt: null, mode: 'undecided' }),
    ...overrides,
  }
}
