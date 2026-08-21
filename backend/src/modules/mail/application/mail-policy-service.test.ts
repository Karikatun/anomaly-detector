import { expect, test } from 'bun:test'

import { MailPolicyFailure } from '../domain/errors'
import { MailPolicyService, normalizeEmailDomain } from './mail-policy-service'

const operator = {
  authenticatedAt: new Date('2026-08-22T11:49:59.999Z'),
  id: '019f8099-7e26-7760-ad08-66d1d66b2718',
}

test('rejects an operator command before source access when sign-in is older than ten minutes', async () => {
  let sourceCalls = 0
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    repository: {} as never,
    source: {
      load: async () => {
        sourceCalls += 1
        throw new Error('must not be reached')
      },
    },
  })

  await expect(service.importCandidates({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2719',
    expectedVersion: 0,
  }, operator)).rejects.toEqual(
    new MailPolicyFailure(
      'recent_authentication_required',
      'Recent authentication is required for mail policy commands',
    ),
  )
  expect(sourceCalls).toBe(0)
})

test('normalizes only the domain boundary without applying provider alias rules', () => {
  expect(normalizeEmailDomain(' Yandex.RU. ')).toBe('yandex.ru')
  expect(normalizeEmailDomain('почта.рф')).toMatch(/^xn--[a-z0-9-]+\.xn--p1ai$/)
  expect(() => normalizeEmailDomain('https://yandex.ru')).toThrow()
  expect(() => normalizeEmailDomain('localhost')).toThrow()
})
