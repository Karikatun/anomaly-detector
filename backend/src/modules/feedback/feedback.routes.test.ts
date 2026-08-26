import { expect, test } from 'bun:test'
import type { MiddlewareHandler } from 'hono'

import type { AuthenticatedPrincipal, AuthHttpEnv } from '../auth'
import { createFeedbackRoutes } from './transport/routes'

const player: AuthenticatedPrincipal = {
  authenticatedAt: new Date('2026-08-23T10:00:00.000Z'),
  createdAt: '2026-08-01T10:00:00.000Z',
  displayName: 'Игрок',
  id: '019f8099-7e26-7760-ad08-66d1d66b2718',
  locale: 'ru',
  login: 'player',
  sessionId: '019f8099-7e26-7760-ad08-66d1d66b2719',
}

const requestBody = {
  category: 'error',
  canContinue: false,
  expectedResult: 'Карточка должна открыться.',
  linkAccount: false,
  replyEmail: null,
  reproductionSteps: 'Открыл матч и нажал на карточку.',
  technicalContext: {
    browserClass: 'chromium',
    buildSha: 'a'.repeat(40),
    deviceClass: 'desktop',
    errorId: null,
    routeTemplate: '/tenders/$tenderId',
  },
  whatHappened: 'Карточка не открылась.',
}

const requireAuth: MiddlewareHandler<AuthHttpEnv> = async (c, next) => {
  if (c.req.header('authorization') !== 'Bearer player-token') {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401)
  }
  c.set('user', player)
  await next()
}

test('accepts an authenticated bounded report and passes only trusted identity context', async () => {
  let received: unknown
  const routes = createFeedbackRoutes({
    authenticatedMutationBudget: async (_c, next) => next(),
    clientAddress: () => '203.0.113.10',
    intake: {
      submit: async (input) => {
        received = input
        return {
          kind: 'accepted',
          receipt: {
            acceptedAt: '2026-08-23T12:00:00.000Z',
            publicNumber: 'FB-8M4Q2K7P9X',
          },
        }
      },
    },
    requireAuth,
  })

  const response = await routes.request('/', {
    body: JSON.stringify(requestBody),
    headers: {
      Authorization: 'Bearer player-token',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  expect(response.status).toBe(201)
  expect(received).toEqual({
    clientAddress: '203.0.113.10',
    report: requestBody,
    userId: player.id,
  })
  expect(await response.json()).toEqual({
    acceptedAt: '2026-08-23T12:00:00.000Z',
    publicNumber: 'FB-8M4Q2K7P9X',
  })
})

test('requires authentication and never exposes a report read route', async () => {
  const routes = createFeedbackRoutes({
    authenticatedMutationBudget: async (_c, next) => next(),
    clientAddress: () => 'unknown',
    intake: { submit: async () => { throw new Error('must not be called') } },
    requireAuth,
  })

  const anonymous = await routes.request('/', {
    body: JSON.stringify(requestBody),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const read = await routes.request('/FB-8M4Q2K7P9X', {
    headers: { Authorization: 'Bearer player-token' },
  })

  expect(anonymous.status).toBe(401)
  expect(read.status).toBe(404)
})

test('returns a stable rate-limit response without an accepted receipt', async () => {
  const routes = createFeedbackRoutes({
    authenticatedMutationBudget: async (_c, next) => next(),
    clientAddress: () => '203.0.113.10',
    intake: {
      submit: async () => ({ kind: 'rate_limited', retryAfterSeconds: 3_600 }),
    },
    requireAuth,
  })
  routes.onError((error, c) => {
    if ('status' in error && error.status === 429) {
      return c.json({ error: { code: 'RATE_LIMITED', message: error.message } }, 429)
    }
    throw error
  })

  const response = await routes.request('/', {
    body: JSON.stringify(requestBody),
    headers: {
      Authorization: 'Bearer player-token',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('3600')
  expect(JSON.stringify(await response.json())).not.toContain('FB-')
})
