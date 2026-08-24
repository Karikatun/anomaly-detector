import { expect, test } from 'bun:test'

import type { DbClient } from '../db'
import { createRequestBudgetOverviewReader } from './request-budget-overview'
import {
  createRequestBudgetPolicyCatalog,
  requestBudgetPolicyEntries,
} from './request-budget-policy'

test('returns only per-scope rounded lower bounds for exhausted active budget keys', async () => {
  const now = new Date('2026-08-24T12:00:00.000Z')
  let receivedQuery: unknown
  const db = {
    authAbuseBucket: {
      groupBy: async (query: unknown) => {
        receivedQuery = query
        return [
          { _count: { _all: 10 }, count: 5, scope: 'login_failure' },
          { _count: { _all: 10 }, count: 3, scope: 'password_reset_login_hour' },
          { _count: { _all: 10 }, count: 120, scope: 'authenticated_mutation' },
          { _count: { _all: 9 }, count: 3, scope: 'rec_email_account_hour' },
          { _count: { _all: 9 }, count: 3, scope: 'rec_email_address_hour' },
          { _count: { _all: 19 }, count: 20, scope: 'room_join' },
          { _count: { _all: 20 }, count: 60, scope: 'tender_command' },
          { _count: { _all: 17 }, count: 9, scope: 'realtime_ticket_issue' },
          { _count: { _all: 12 }, count: 99, scope: 'unlisted_internal_scope' },
        ]
      },
    },
  } as unknown as DbClient
  const reader = createRequestBudgetOverviewReader(
    db,
    requestBudgetPolicyEntries(createRequestBudgetPolicyCatalog()),
  )

  const overview = await reader.read(now)

  expect(overview).toEqual({
    groups: [
      {
        exhaustedBudgetKeysAtLeast: 10,
        surface: 'authentication',
      },
      {
        exhaustedBudgetKeysAtLeast: 10,
        surface: 'room_join',
      },
      {
        exhaustedBudgetKeysAtLeast: 20,
        surface: 'tender_command',
      },
    ],
    minimumGroupSize: 10,
    roundingStep: 10,
  })
  expect(receivedQuery).toEqual({
    _count: { _all: true },
    by: ['scope', 'count'],
    where: {
      expiresAt: { gt: now },
      scope: {
        in: [
          'rec_email_account_min',
          'rec_email_account_hour',
          'rec_email_account_day',
          'rec_email_address_min',
          'rec_email_address_hour',
          'rec_email_address_day',
          'rec_email_ip_hour',
          'authenticated_mutation',
          'room_join',
          'tender_command',
          'realtime_ticket_issue',
        ],
      },
    },
  })
  expect(JSON.stringify(overview)).not.toMatch(
    /activeBudgetKeys|exhaustedBudgetKeys"|requests|scope|keyHash|login|email|ip|userId|tenderId/i,
  )
  expect(await createRequestBudgetOverviewReader(db, []).read(now)).toEqual({
    groups: [],
    minimumGroupSize: 10,
    roundingStep: 10,
  })
})
