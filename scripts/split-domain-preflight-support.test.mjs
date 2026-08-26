import { describe, expect, test } from 'bun:test'

import {
  assertExcludesLocalServiceOrigins,
  disabledWebappAnalyticsEnvironment,
  disabledWebsiteAnalyticsEnvironment,
  withoutEnvironment,
} from './split-domain-preflight-support.mjs'

describe('split-domain release artifact policy', () => {
  test.each([
    'http://localhost/',
    'http://localhost:3000/api',
    'http://0.0.0.0:4321',
    'http://127.8.9.10:5432',
    'http://[::1]:3000',
    'https://api.anomaly-detector.localhost:64000/api',
  ])('rejects local service origin %s', (origin) => {
    expect(() => assertExcludesLocalServiceOrigins(`bundle=${origin}`, 'fixture')).toThrow(
      'fixture contains a local test service origin',
    )
  })

  test('allows production and standards-document URLs', () => {
    expect(() => assertExcludesLocalServiceOrigins(
      'https://api.anomaly-detector.ru https://www.w3.org/2000/svg http://localhost',
      'fixture',
    )).not.toThrow()
  })

  test('removes inherited owner-gated analytics values from both release builds', () => {
    const inherited = {
      KEEP: 'value',
      VITE_ANALYTICS_ENABLED: 'true',
      PUBLIC_ANALYTICS_API_URL: 'https://attacker.example',
      PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST: 'ambient',
    }
    const webapp = withoutEnvironment(inherited, { RELEASE: 'webapp' }, disabledWebappAnalyticsEnvironment)
    const website = withoutEnvironment(inherited, { RELEASE: 'website' }, disabledWebsiteAnalyticsEnvironment)

    expect(webapp.VITE_ANALYTICS_ENABLED).toBeUndefined()
    expect(webapp.KEEP).toBe('value')
    expect(website.PUBLIC_ANALYTICS_API_URL).toBeUndefined()
    expect(website.PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST).toBeUndefined()
    expect(website.KEEP).toBe('value')
  })
})
