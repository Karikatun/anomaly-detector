import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { createPrismaAnalytics } from './prisma-analytics'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const now = new Date('2026-08-23T12:00:00.000Z')

maybeDescribe('Prisma privacy-aware analytics', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const analytics = createPrismaAnalytics(prisma, {
    campaignAllowlist: new Set(['launch_ru']),
    clock: { now: () => now },
    fingerprintKey: 'analytics-test-secret-at-least-32-bytes',
  })

  beforeEach(async () => {
    await prisma.analyticsEvent.deleteMany()
    await prisma.analyticsJourney.deleteMany()
    await prisma.analyticsDailyAggregate.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('counts a pre-consent view without creating a visitor identifier', async () => {
    await analytics.recordLandingView({
      campaign: null,
      referrerDomain: 'example.org',
      trafficClass: 'human',
    })

    expect(await prisma.analyticsJourney.count()).toBe(0)
    expect(await prisma.analyticsEvent.count()).toBe(0)
    expect(await prisma.analyticsDailyAggregate.findFirstOrThrow()).toMatchObject({
      count: 1,
      metric: 'event:landing_view',
      sourceCategory: 'referral',
      trafficClass: 'human',
    })
  })

  test('grants consent idempotently while persisting only HMAC derivatives', async () => {
    const command = {
      campaign: 'launch_ru',
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      referrerDomain: null,
      trafficClass: 'human' as const,
    }

    const [first, retry] = await Promise.all([
      analytics.grant(command),
      analytics.grant(command),
    ])

    expect(retry).toEqual(first)
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await prisma.analyticsJourney.count()).toBe(1)
    const stored = await prisma.analyticsJourney.findFirstOrThrow()
    expect(stored.journeyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.grantCommandKey).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(first.token)
    expect(JSON.stringify(stored)).not.toContain(command.commandId)
  })

  test('rejects a reused consent command with different normalized source data', async () => {
    const commandId = '019f8099-7e26-7760-ad08-66d1d66b2723'
    await analytics.grant({
      campaign: null,
      commandId,
      referrerDomain: null,
      trafficClass: 'human',
    })

    await expect(analytics.grant({
      campaign: null,
      commandId,
      referrerDomain: 'example.org',
      trafficClass: 'human',
    })).rejects.toThrow('analytics consent command conflict')
    expect(await prisma.analyticsJourney.count()).toBe(1)
  })

  test('deduplicates linked events and adjacent transitions even out of order', async () => {
    const consent = await analytics.grant({
      campaign: null,
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2721',
      referrerDomain: null,
      trafficClass: 'human',
    })

    await Promise.all([
      analytics.recordEvent(consent.token, 'tutorial_complete'),
      analytics.recordEvent(consent.token, 'registration_complete'),
      analytics.recordEvent(consent.token, 'registration_complete'),
    ])
    await analytics.recordEvent(consent.token, 'tutorial_cta')

    expect(await prisma.analyticsEvent.count()).toBe(3)
    const aggregates = await prisma.analyticsDailyAggregate.findMany({
      orderBy: { metric: 'asc' },
    })
    expect(aggregates.filter((item) => item.metric.startsWith('event:'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 1, metric: 'event:tutorial_cta' }),
      expect.objectContaining({ count: 1, metric: 'event:registration_complete' }),
      expect.objectContaining({ count: 1, metric: 'event:tutorial_complete' }),
    ]))
    expect(aggregates.filter((item) => item.metric.startsWith('transition:'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 1, metric: 'transition:landing_view:tutorial_cta' }),
      expect.objectContaining({ count: 1, metric: 'transition:tutorial_cta:registration_complete' }),
      expect.objectContaining({ count: 1, metric: 'transition:registration_complete:tutorial_complete' }),
    ]))
  })

  test('revokes the identifier and raw events without rewriting anonymous aggregates', async () => {
    const consent = await analytics.grant({
      campaign: null,
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2722',
      referrerDomain: null,
      trafficClass: 'human',
    })
    await analytics.recordEvent(consent.token, 'tutorial_cta')
    const aggregateCount = await prisma.analyticsDailyAggregate.count()

    expect(await analytics.revoke(consent.token)).toBe(true)
    expect(await analytics.recordEvent(consent.token, 'registration_complete')).toBe(false)
    expect(await prisma.analyticsJourney.count()).toBe(0)
    expect(await prisma.analyticsEvent.count()).toBe(0)
    expect(await prisma.analyticsDailyAggregate.count()).toBe(aggregateCount)
  })

  test('keeps bots out of the human funnel and enforces raw/aggregate retention', async () => {
    await analytics.recordLandingView({
      campaign: null,
      referrerDomain: null,
      trafficClass: 'known_bot',
    })
    await prisma.analyticsDailyAggregate.create({
      data: {
        day: new Date('2025-07-22T00:00:00.000Z'),
        metric: 'event:landing_view',
        sourceCategory: 'direct',
        trafficClass: 'human',
        count: 1,
      },
    })
    await prisma.analyticsJourney.create({
      data: {
        consentedAt: new Date('2026-07-23T11:59:59.000Z'),
        expiresAt: new Date('2026-08-22T11:59:59.000Z'),
        grantCommandKey: 'a'.repeat(64),
        journeyKey: 'b'.repeat(64),
        sourceCategory: 'direct',
        trafficClass: 'human',
      },
    })

    const overview = await analytics.readOverview({ windowDays: 30 })
    expect(overview.botLandingViews).toBe(1)
    expect(overview.steps.find((step) => step.event === 'landing_view')?.count).toBe(0)

    expect(await analytics.cleanup(now)).toEqual({ aggregates: 1, journeys: 1 })
  })

  test('projects one daily point across safe source categories without a visitor drilldown', async () => {
    await analytics.recordLandingView({
      campaign: null,
      referrerDomain: null,
      trafficClass: 'human',
    })
    await analytics.recordLandingView({
      campaign: null,
      referrerDomain: 'example.org',
      trafficClass: 'human',
    })

    const overview = await analytics.readOverview({ windowDays: 7 })
    expect(overview.daily).toEqual([{
      count: 2,
      date: '2026-08-23',
      event: 'landing_view',
    }])
    expect(overview.sources).toEqual(expect.arrayContaining([
      { category: 'direct', landingViews: 1 },
      { category: 'referral', landingViews: 1 },
    ]))
  })
})
