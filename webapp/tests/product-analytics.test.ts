import { describe, expect, test } from 'bun:test'

import { ProductAnalytics } from '../src/platform/analytics/product-analytics'

describe('ProductAnalytics', () => {
  test('sends only a strict consent-scoped funnel event with first-party credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const analytics = new ProductAnalytics({
      apiBaseUrl: 'https://api.example.test',
      beacon: null,
      enabled: true,
      fetcher: async (input, init) => {
        calls.push({ input, init })
        return new Response(null, { status: 204 })
      },
    })

    await analytics.record('registration_complete')

    expect(calls).toHaveLength(1)
    expect(String(calls[0].input)).toBe('https://api.example.test/api/analytics/events')
    expect(calls[0].init).toMatchObject({
      body: JSON.stringify({ event: 'registration_complete' }),
      credentials: 'include',
      keepalive: true,
      method: 'POST',
    })
    expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/json')
  })

  test('uses the browser beacon transport without waiting for a response', async () => {
    const beacons: Array<{ data?: BodyInit | null; url: string }> = []
    const analytics = new ProductAnalytics({
      apiBaseUrl: 'https://api.example.test/',
      beacon: (url, data) => {
        beacons.push({ data, url })
        return true
      },
      enabled: true,
      fetcher: async () => { throw new Error('fetch fallback must not run') },
    })

    await analytics.record('tutorial_complete')

    expect(beacons).toEqual([{
      data: JSON.stringify({ event: 'tutorial_complete' }),
      url: 'https://api.example.test/api/analytics/events',
    }])
  })

  test('does nothing while disabled and never breaks the product flow on failure', async () => {
    let calls = 0
    const disabled = new ProductAnalytics({
      apiBaseUrl: 'https://api.example.test',
      beacon: null,
      enabled: false,
      fetcher: async () => { calls += 1; throw new Error('must not run') },
    })
    await expect(disabled.record('tutorial_complete')).resolves.toBeUndefined()
    expect(calls).toBe(0)

    const unavailable = new ProductAnalytics({
      apiBaseUrl: 'https://api.example.test',
      beacon: null,
      enabled: true,
      fetcher: async () => { throw new Error('analytics unavailable') },
    })
    await expect(unavailable.record('recovery_email_confirmed')).resolves.toBeUndefined()
  })
})
