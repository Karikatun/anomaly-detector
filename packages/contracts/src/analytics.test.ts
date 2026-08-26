import { describe, expect, test } from 'bun:test'

import {
  analyticsAdminOverviewSchema,
  analyticsAdminQuerySchema,
  analyticsConsentCommandSchema,
  analyticsConsentStatusSchema,
  analyticsEventCommandSchema,
  analyticsLandingViewSchema,
} from './analytics'

describe('analytics player contracts', () => {
  test('accepts only bounded consent, source and funnel fields', () => {
    expect(analyticsLandingViewSchema.parse({
      campaign: 'launch_ru',
      referrerDomain: 'example.org',
    })).toEqual({ campaign: 'launch_ru', referrerDomain: 'example.org' })

    expect(analyticsConsentCommandSchema.parse({
      campaign: null,
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      referrerDomain: null,
    }).commandId).toBe('019f8099-7e26-7760-ad08-66d1d66b2720')

    expect(analyticsEventCommandSchema.parse({
      event: 'tutorial_complete',
    }).event).toBe('tutorial_complete')

    for (const forbidden of [
      { accountId: '019f8099-7e26-7760-ad08-66d1d66b2718' },
      { email: 'player@example.org' },
      { fullIp: '203.0.113.10' },
      { fullUrl: 'https://example.org/path?token=secret' },
      { login: 'player' },
      { userAgent: 'raw browser fingerprint' },
    ]) {
      expect(analyticsLandingViewSchema.safeParse({
        campaign: null,
        referrerDomain: null,
        ...forbidden,
      }).success).toBe(false)
    }

    expect(analyticsLandingViewSchema.safeParse({
      campaign: null,
      referrerDomain: 'https://example.org/path?secret=1',
    }).success).toBe(false)
    expect(analyticsConsentCommandSchema.safeParse({
      campaign: 'launch?email=player@example.org',
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      referrerDomain: null,
    }).success).toBe(false)
    expect(analyticsEventCommandSchema.safeParse({ event: 'password_reset' }).success).toBe(false)
  })

  test('returns a privacy-safe consent status only', () => {
    expect(analyticsConsentStatusSchema.parse({
      expiresAt: '2026-09-22T12:00:00.000Z',
      mode: 'allowed',
    })).toEqual({
      expiresAt: '2026-09-22T12:00:00.000Z',
      mode: 'allowed',
    })
    expect(analyticsConsentStatusSchema.safeParse({
      journeyId: 'raw-cross-surface-id',
      mode: 'allowed',
    }).success).toBe(false)
  })
})

describe('analytics operator contracts', () => {
  test('limits windows and exposes aggregates without raw visitor dimensions', () => {
    expect(analyticsAdminQuerySchema.parse({ windowDays: '30' })).toEqual({ windowDays: 30 })
    expect(analyticsAdminQuerySchema.safeParse({ windowDays: 31 }).success).toBe(false)

    const overview = analyticsAdminOverviewSchema.parse({
      botLandingViews: 3,
      daily: [{ count: 4, date: '2026-08-23', event: 'landing_view' }],
      generatedAt: '2026-08-23T12:00:00.000Z',
      sources: [{ category: 'direct', landingViews: 4 }],
      steps: [{ count: 4, event: 'landing_view' }],
      transitions: [{
        conversionRate: 0.5,
        count: 2,
        from: 'landing_view',
        to: 'tutorial_cta',
      }],
      windowDays: 30,
    })

    expect(overview.windowDays).toBe(30)
    expect(JSON.stringify(overview)).not.toMatch(/"(?:accountId|cookie|email|ipAddress|journeyId|login|rawEvents|userId)"/i)
    expect(analyticsAdminOverviewSchema.safeParse({
      ...overview,
      rawEvents: [{ journeyId: 'secret' }],
    }).success).toBe(false)
  })
})
