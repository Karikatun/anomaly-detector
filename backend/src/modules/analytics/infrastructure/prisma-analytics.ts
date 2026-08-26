import { createHmac } from 'node:crypto'

import {
  analyticsAdminOverviewSchema,
  type AnalyticsAdminOverview,
  type AnalyticsFunnelEvent,
  type AnalyticsLinkedEvent,
  type AnalyticsSourceCategory,
  type AnalyticsTrafficClass,
} from '@anomaly-detector/contracts'

import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import { classifyAnalyticsSource } from '../application/classification'
import type { AnalyticsStore } from '../application/ports'
import { cleanupAnalyticsData } from './prisma-analytics-cleanup'

const JOURNEY_TTL_MS = 30 * 24 * 60 * 60 * 1_000
const funnelEvents = [
  'landing_view',
  'tutorial_cta',
  'registration_complete',
  'tutorial_complete',
  'recovery_email_confirmed',
] as const satisfies readonly AnalyticsFunnelEvent[]
const linkedEvents = funnelEvents.slice(1) as readonly AnalyticsLinkedEvent[]
const sourceCategories = ['direct', 'referral', 'campaign', 'unknown'] as const satisfies readonly AnalyticsSourceCategory[]

type Options = {
  campaignAllowlist: ReadonlySet<string>
  clock?: { now(): Date }
  fingerprintKey: string
}

const systemClock = { now: () => new Date() }

export function createPrismaAnalytics(db: DbClient, options: Options): AnalyticsStore {
  const clock = options.clock ?? systemClock
  const campaignAllowlist = new Set(
    [...options.campaignAllowlist].map((campaign) => campaign.toLowerCase()),
  )

  return {
    async recordLandingView(input) {
      const now = clock.now()
      const sourceCategory = classifyAnalyticsSource({ ...input, campaignAllowlist })
      await incrementAggregate(db, {
        day: utcDay(now),
        metric: eventMetric('landing_view'),
        sourceCategory,
        trafficClass: input.trafficClass,
      })
    },

    async grant(input) {
      const now = clock.now()
      const expiresAt = new Date(now.getTime() + JOURNEY_TTL_MS)
      const sourceCategory = classifyAnalyticsSource({ ...input, campaignAllowlist })
      const token = hmacBase64Url(
        options.fingerprintKey,
        `analytics-journey-token:${input.commandId}:${sourceCategory}:${input.trafficClass}`,
      )
      const journeyKey = hmacHex(options.fingerprintKey, `analytics-journey-key:${token}`)
      const grantCommandKey = hmacHex(options.fingerprintKey, `analytics-grant-command:${input.commandId}`)

      const stored = await db.$transaction(async (tx) => {
        await lock(tx, `analytics-grant:${grantCommandKey}`)
        const existing = await tx.analyticsJourney.findUnique({ where: { grantCommandKey } })
        if (existing) {
          if (existing.journeyKey !== journeyKey) {
            throw new Error('analytics consent command conflict')
          }
          return existing
        }
        return tx.analyticsJourney.create({
          data: {
            consentedAt: now,
            expiresAt,
            grantCommandKey,
            journeyKey,
            sourceCategory,
            trafficClass: input.trafficClass,
          },
        })
      })

      return { expiresAt: stored.expiresAt, token }
    },

    async status(token) {
      if (!validToken(token)) return { expiresAt: null, mode: 'undecided' }
      const now = clock.now()
      const journeyKey = hmacHex(options.fingerprintKey, `analytics-journey-key:${token}`)
      const journey = await db.analyticsJourney.findUnique({ where: { journeyKey } })
      if (!journey || journey.expiresAt <= now) return { expiresAt: null, mode: 'undecided' }
      return { expiresAt: journey.expiresAt.toISOString(), mode: 'allowed' }
    },

    async revoke(token) {
      if (!validToken(token)) return false
      const journeyKey = hmacHex(options.fingerprintKey, `analytics-journey-key:${token}`)
      return db.$transaction(async (tx) => {
        await lock(tx, `analytics-journey:${journeyKey}`)
        const deleted = await tx.analyticsJourney.deleteMany({ where: { journeyKey } })
        return deleted.count > 0
      })
    },

    async recordEvent(token, event) {
      if (!validToken(token)) return false
      const now = clock.now()
      const journeyKey = hmacHex(options.fingerprintKey, `analytics-journey-key:${token}`)
      return db.$transaction(async (tx) => {
        await lock(tx, `analytics-journey:${journeyKey}`)
        const journey = await tx.analyticsJourney.findUnique({ where: { journeyKey } })
        if (!journey || journey.expiresAt <= now) return false
        const created = await tx.analyticsEvent.createMany({
          data: [{ journeyId: journey.id, kind: event, occurredAt: now }],
          skipDuplicates: true,
        })
        if (created.count === 0) return true

        const aggregate = {
          day: utcDay(now),
          sourceCategory: journey.sourceCategory as AnalyticsSourceCategory,
          trafficClass: journey.trafficClass as AnalyticsTrafficClass,
        }
        await incrementAggregate(tx, { ...aggregate, metric: eventMetric(event) })

        const eventIndex = funnelEvents.indexOf(event)
        const previous = funnelEvents[eventIndex - 1]
        const next = funnelEvents[eventIndex + 1]
        if (previous && (previous === 'landing_view' || await hasEvent(tx, journey.id, previous))) {
          await incrementAggregate(tx, {
            ...aggregate,
            metric: transitionMetric(previous, event),
          })
        }
        if (next && linkedEvents.includes(next as AnalyticsLinkedEvent)
          && await hasEvent(tx, journey.id, next)) {
          await incrementAggregate(tx, {
            ...aggregate,
            metric: transitionMetric(event, next),
          })
        }
        return true
      })
    },

    async readOverview(query) {
      const generatedAt = clock.now()
      const firstDay = utcDay(new Date(
        generatedAt.getTime() - (query.windowDays - 1) * 24 * 60 * 60 * 1_000,
      ))
      const rows = await db.analyticsDailyAggregate.findMany({
        where: { day: { gte: firstDay } },
      })
      return analyticsAdminOverviewSchema.parse(projectOverview(rows, query.windowDays, generatedAt))
    },

    async cleanup(now) {
      return cleanupAnalyticsData(db, now)
    },
  }
}

type AggregateIdentity = {
  day: Date
  metric: string
  sourceCategory: AnalyticsSourceCategory
  trafficClass: AnalyticsTrafficClass
}

type AggregateDb = Pick<Prisma.TransactionClient, 'analyticsDailyAggregate'>

function incrementAggregate(db: AggregateDb, identity: AggregateIdentity) {
  return db.analyticsDailyAggregate.upsert({
    where: {
      day_metric_sourceCategory_trafficClass: identity,
    },
    create: { ...identity, count: 1 },
    update: { count: { increment: 1 } },
  })
}

async function hasEvent(
  tx: Pick<Prisma.TransactionClient, 'analyticsEvent'>,
  journeyId: string,
  event: AnalyticsFunnelEvent,
) {
  return (await tx.analyticsEvent.count({ where: { journeyId, kind: event } })) > 0
}

function projectOverview(
  rows: Array<{
    count: number
    day: Date
    metric: string
    sourceCategory: string
    trafficClass: string
  }>,
  windowDays: 7 | 30 | 90,
  generatedAt: Date,
): AnalyticsAdminOverview {
  const humanRows = rows.filter((row) => row.trafficClass === 'human')
  const stepCount = (event: AnalyticsFunnelEvent) => sum(
    humanRows.filter((row) => row.metric === eventMetric(event)),
  )
  const steps = funnelEvents.map((event) => ({ count: stepCount(event), event }))
  const transitions = funnelEvents.slice(0, -1).map((from, index) => {
    const to = funnelEvents[index + 1]
    const count = sum(humanRows.filter((row) => row.metric === transitionMetric(from, to)))
    const denominator = stepCount(from)
    return {
      conversionRate: denominator === 0 ? 0 : Math.min(1, count / denominator),
      count,
      from,
      to,
    }
  })
  const dailyCounts = new Map<string, {
    count: number
    date: string
    event: AnalyticsFunnelEvent
  }>()
  for (const row of humanRows) {
    if (!row.metric.startsWith('event:')) continue
    const event = row.metric.slice('event:'.length) as AnalyticsFunnelEvent
    if (!funnelEvents.includes(event)) continue
    const date = row.day.toISOString().slice(0, 10)
    const key = `${date}:${event}`
    const current = dailyCounts.get(key)
    dailyCounts.set(key, { count: (current?.count ?? 0) + row.count, date, event })
  }
  const daily = [...dailyCounts.values()]
    .sort((left, right) => left.date.localeCompare(right.date) || left.event.localeCompare(right.event))

  return {
    botLandingViews: sum(rows.filter((row) =>
      row.trafficClass === 'known_bot' && row.metric === eventMetric('landing_view'))),
    daily,
    generatedAt: generatedAt.toISOString(),
    sources: sourceCategories.map((category) => ({
      category,
      landingViews: sum(humanRows.filter((row) =>
        row.metric === eventMetric('landing_view') && row.sourceCategory === category)),
    })),
    steps,
    transitions,
    windowDays,
  }
}

function sum(rows: Array<{ count: number }>) {
  return rows.reduce((total, row) => total + row.count, 0)
}

function eventMetric(event: AnalyticsFunnelEvent) {
  return `event:${event}`
}

function transitionMetric(from: AnalyticsFunnelEvent, to: AnalyticsFunnelEvent) {
  return `transition:${from}:${to}`
}

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function hmacHex(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function hmacBase64Url(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function validToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

function lock(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, key: string) {
  return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"`
}
