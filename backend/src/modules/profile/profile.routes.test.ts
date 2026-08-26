import { expect, test } from 'bun:test'
import { createMiddleware } from 'hono/factory'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import { createProfileModule } from './index'

const authenticatedMutationBudget = createMiddleware<AuthHttpEnv>(async (_c, next) => {
  await next()
})

test('returns authenticated player statistics from compatible completed matches', async () => {
  const db = {} as DbClient
  const requireAuth = createMiddleware<AuthHttpEnv>(async (c, next) => {
    c.set('user', {
      authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: '2026-01-01T00:00:00.000Z',
      displayName: 'Player',
      id: 'player-a',
      locale: 'ru',
      login: 'player',
      sessionId: 'session-a',
    })
    await next()
  })
  const profile = createProfileModule({
    authenticatedMutationBudget,
    completedTenderSummaryReader: {
      listCompletedMatches: async () => [{
        excludeFromPerformanceAverages: false,
        players: [
          { budget: 2, correctTheses: 1, playerId: 'player-a', rating: 9 },
          { budget: 3, correctTheses: 0, playerId: 'player-b', rating: 7 },
        ],
        playerResult: {
          correctModelProperties: 6,
          submittedContracts: 2,
          successfulContracts: 1,
        },
        winnerPlayerIds: ['player-a'],
      }],
    },
    db,
    requireAuth,
  })

  const response = await profile.routes.request('/statistics', {
    headers: { Authorization: 'Bearer valid-token' },
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    averagePlacement: 1,
    averageRating: 9,
    contractSuccessRate: 0.5,
    matchesPlayed: 1,
    modelAccuracy: 0.5,
    wins: 1,
    winRate: 1,
  })
})

test('reads and idempotently records the authenticated player tutorial completion', async () => {
  let completedAt: Date | null = null
  const db = {
    tenderRoom: { findMany: async () => [] },
    user: {
      findUnique: async () => ({ tutorialCompletedAt: completedAt }),
      findUniqueOrThrow: async () => ({ tutorialCompletedAt: completedAt }),
      updateMany: async ({ data }: { data: { tutorialCompletedAt: Date } }) => {
        completedAt ??= data.tutorialCompletedAt
        return { count: 1 }
      },
    },
  } as unknown as DbClient
  const requireAuth = createMiddleware<AuthHttpEnv>(async (c, next) => {
    c.set('user', {
      authenticatedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: '2026-01-01T00:00:00.000Z',
      displayName: 'Player',
      id: 'player-a',
      locale: 'ru',
      login: 'player',
      sessionId: 'session-a',
    })
    await next()
  })
  const profile = createProfileModule({
    authenticatedMutationBudget,
    completedTenderSummaryReader: { listCompletedMatches: async () => [] },
    db,
    requireAuth,
  })

  const initial = await profile.routes.request('/tutorial')
  expect(initial.status).toBe(200)
  expect(await initial.json()).toEqual({ completedAt: null })

  const completed = await profile.routes.request('/tutorial/completion', { method: 'PUT' })
  expect(completed.status).toBe(200)
  const firstCompletion = await completed.json() as { completedAt: string }
  expect(firstCompletion.completedAt).toBeString()

  const repeated = await profile.routes.request('/tutorial/completion', { method: 'PUT' })
  expect(await repeated.json()).toEqual(firstCompletion)
})
