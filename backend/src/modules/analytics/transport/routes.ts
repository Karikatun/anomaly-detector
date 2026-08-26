import {
  analyticsConsentCommandSchema,
  analyticsConsentStatusSchema,
  analyticsEventCommandSchema,
  analyticsLandingViewSchema,
} from '@anomaly-detector/contracts'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

import { classifyAnalyticsTraffic } from '../application/classification'
import type { AnalyticsStore } from '../application/ports'

const JOURNEY_COOKIE = 'anomaly_detector_analytics_journey'
const CHOICE_COOKIE = 'anomaly_detector_analytics_choice'
const COOKIE_PATH = '/api/analytics'
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export function createAnalyticsRoutes(input: {
  cookieSecure: boolean
  store: AnalyticsStore
}) {
  const routes = new OpenAPIHono()

  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })

  routes.post('/events/landing', async (c) => {
    const event = analyticsLandingViewSchema.parse(await c.req.json())
    await input.store.recordLandingView({
      ...event,
      trafficClass: classifyAnalyticsTraffic(c.req.header('user-agent')),
    })
    return c.body(null, 204)
  })

  routes.get('/consent/status', async (c) => {
    const token = getCookie(c, JOURNEY_COOKIE)
    if (token) {
      const status = await input.store.status(token)
      if (status.mode === 'allowed') return c.json(analyticsConsentStatusSchema.parse(status))
    }
    const mode = getCookie(c, CHOICE_COOKIE) === 'necessary' ? 'necessary' : 'undecided'
    return c.json(analyticsConsentStatusSchema.parse({ expiresAt: null, mode }))
  })

  routes.post('/consent/allow', async (c) => {
    const command = analyticsConsentCommandSchema.parse(await c.req.json())
    const grant = await input.store.grant({
      ...command,
      trafficClass: classifyAnalyticsTraffic(c.req.header('user-agent')),
    })
    setCookie(c, JOURNEY_COOKIE, grant.token, cookieOptions(input.cookieSecure))
    clearCookie(c, CHOICE_COOKIE, input.cookieSecure)
    return c.json(analyticsConsentStatusSchema.parse({
      expiresAt: grant.expiresAt.toISOString(),
      mode: 'allowed',
    }))
  })

  const chooseNecessary = async (c: Context) => {
    const token = getCookie(c, JOURNEY_COOKIE)
    if (token) await input.store.revoke(token)
    clearCookie(c, JOURNEY_COOKIE, input.cookieSecure)
    setCookie(c, CHOICE_COOKIE, 'necessary', cookieOptions(input.cookieSecure))
    return c.json(analyticsConsentStatusSchema.parse({ expiresAt: null, mode: 'necessary' }))
  }

  routes.post('/consent/necessary', chooseNecessary)
  routes.post('/consent/revoke', chooseNecessary)

  routes.post('/events', async (c) => {
    const event = analyticsEventCommandSchema.parse(await c.req.json())
    const token = getCookie(c, JOURNEY_COOKIE)
    if (token) await input.store.recordEvent(token, event.event)
    return c.body(null, 204)
  })

  return routes
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: COOKIE_PATH,
    sameSite: 'Lax' as const,
    secure,
  }
}

function clearCookie(
  context: Parameters<typeof setCookie>[0],
  name: string,
  secure: boolean,
) {
  setCookie(context, name, '', {
    ...cookieOptions(secure),
    maxAge: 0,
  })
}
