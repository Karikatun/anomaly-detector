import { expect, test } from 'bun:test'

import { MailPolicyFailure } from '../domain/errors'
import { MailPolicyService, normalizeEmailDomain } from './mail-policy-service'

const operator = {
  authenticatedAt: new Date('2026-08-22T11:49:59.999Z'),
  id: '019f8099-7e26-7760-ad08-66d1d66b2718',
}

test('rejects an operator command before repository access when sign-in is older than ten minutes', async () => {
  let repositoryCalls = 0
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    mxResolver: {} as never,
    repository: {
      findCommand: async () => {
        repositoryCalls += 1
        throw new Error('must not be reached')
      },
    } as never,
  })

  await expect(service.syncCatalog({
    commandId: '019f8099-7e26-7760-ad08-66d1d66b2719',
    expectedVersion: 0,
  }, operator)).rejects.toEqual(
    new MailPolicyFailure(
      'recent_authentication_required',
      'Recent authentication is required for mail policy commands',
    ),
  )
  expect(repositoryCalls).toBe(0)
})

test('resolves and stores an exact custom-domain MX assessment outside the policy transaction', async () => {
  const evaluations = [
    {
      acceptsNewAddress: false,
      allowsRecoveryDelivery: false,
      canonicalization: null,
      catalogVersion: 1,
      providerId: null,
      requiresMxAssessment: true,
      state: 'unlisted' as const,
      version: 1,
    },
    {
      acceptsNewAddress: false,
      allowsRecoveryDelivery: false,
      canonicalization: null,
      catalogVersion: 1,
      providerId: null,
      requiresMxAssessment: true,
      state: 'unlisted' as const,
      version: 1,
    },
    {
      acceptsNewAddress: true,
      allowsRecoveryDelivery: true,
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      catalogVersion: 1,
      providerId: 'reg_ru',
      requiresMxAssessment: false,
      state: 'approved' as const,
      version: 1,
    },
  ]
  const stored: unknown[] = []
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    mxResolver: {
      resolve: async () => ({
        exchanges: ['MX2.HOSTING.REG.RU.', 'mx1.hosting.reg.ru'],
        kind: 'resolved' as const,
      }),
    },
    repository: {
      evaluate: async () => evaluations.shift(),
      storeAssessment: async (input: unknown) => { stored.push(input) },
    } as never,
  })

  const decision = await service.evaluate('Anomaly-Detector.RU')

  expect(decision.providerId).toBe('reg_ru')
  expect(stored).toEqual([expect.objectContaining({
    catalogVersion: 1,
    emailDomain: 'anomaly-detector.ru',
    outcome: 'allowed',
    providerId: 'reg_ru',
  })])
  expect(JSON.stringify(stored)).not.toContain('hosting.reg.ru')
})

test('forces a fresh custom-domain MX resolution for delivery but never for a public domain', async () => {
  let resolverCalls = 0
  const cachedCustomDecision = {
    acceptsNewAddress: true,
    allowsRecoveryDelivery: true,
    canonicalization: {
      ignoreDots: false,
      localPartCaseInsensitive: false,
      stripPlusTag: false,
    },
    catalogVersion: 1,
    providerId: 'yandex',
    requiresMxAssessment: false,
    source: 'mx' as const,
    state: 'approved' as const,
    version: 1,
  }
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    mxResolver: {
      resolve: async () => {
        resolverCalls += 1
        return { exchanges: ['aspmx.l.google.com'], kind: 'resolved' as const }
      },
    },
    repository: {
      evaluate: async (emailDomain: string) => emailDomain === 'yandex.ru'
        ? { ...cachedCustomDecision, source: 'public_domain' as const }
        : cachedCustomDecision,
      storeAssessment: async () => undefined,
    } as never,
  })

  await service.evaluate('yandex.ru', { forceMxRefresh: true })
  await service.evaluate('company.ru', { forceMxRefresh: true })

  expect(resolverCalls).toBe(1)
})

test('forces MX refresh fail-closed while the bundled and stored catalogs differ', async () => {
  let resolverCalls = 0
  const cached = {
    acceptsNewAddress: true,
    allowsRecoveryDelivery: true,
    canonicalization: { ignoreDots: false, localPartCaseInsensitive: false, stripPlusTag: false },
    catalogVersion: 2,
    providerId: 'reg_ru',
    requiresMxAssessment: false,
    source: 'mx' as const,
    state: 'approved' as const,
    version: 2,
  }
  const unlisted = {
    acceptsNewAddress: false,
    allowsRecoveryDelivery: false,
    canonicalization: null,
    catalogVersion: 2,
    providerId: null,
    requiresMxAssessment: true,
    state: 'unlisted' as const,
    version: 2,
  }
  const evaluations = [cached, unlisted]
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    mxResolver: {
      resolve: async () => {
        resolverCalls += 1
        return { exchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'], kind: 'resolved' as const }
      },
    },
    repository: {
      evaluate: async () => evaluations.shift(),
      storeAssessment: async () => undefined,
    } as never,
  })

  await expect(service.evaluate('company.ru', { forceMxRefresh: true })).resolves.toEqual(unlisted)
  expect(resolverCalls).toBe(1)
})

test('uses the published decision source when a bundled public domain differs from stored policy', async () => {
  let resolverCalls = 0
  const cached = {
    acceptsNewAddress: true,
    allowsRecoveryDelivery: true,
    canonicalization: { ignoreDots: false, localPartCaseInsensitive: false, stripPlusTag: false },
    catalogVersion: 2,
    providerId: 'yandex',
    requiresMxAssessment: false,
    source: 'mx' as const,
    state: 'approved' as const,
    version: 2,
  }
  const unlisted = {
    acceptsNewAddress: false,
    allowsRecoveryDelivery: false,
    canonicalization: null,
    catalogVersion: 2,
    providerId: null,
    requiresMxAssessment: true,
    state: 'unlisted' as const,
    version: 2,
  }
  const evaluations = [cached, unlisted]
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    mxResolver: {
      resolve: async () => {
        resolverCalls += 1
        return { exchanges: ['aspmx.l.google.com'], kind: 'resolved' as const }
      },
    },
    repository: {
      evaluate: async () => evaluations.shift(),
      storeAssessment: async () => undefined,
    } as never,
  })

  await expect(service.evaluate('yandex.ru', { forceMxRefresh: true })).resolves.toEqual(unlisted)
  expect(resolverCalls).toBe(1)
})

test('coalesces concurrent MX refreshes for one custom domain', async () => {
  let resolverCalls = 0
  let stored = false
  let releaseLookup!: () => void
  const lookupReleased = new Promise<void>((resolve) => { releaseLookup = resolve })
  const unlisted = {
    acceptsNewAddress: false,
    allowsRecoveryDelivery: false,
    canonicalization: null,
    catalogVersion: 1,
    providerId: null,
    requiresMxAssessment: true,
    state: 'unlisted' as const,
    version: 1,
  }
  const allowed = {
    acceptsNewAddress: true,
    allowsRecoveryDelivery: true,
    canonicalization: { ignoreDots: false, localPartCaseInsensitive: false, stripPlusTag: false },
    catalogVersion: 1,
    providerId: 'reg_ru',
    requiresMxAssessment: false,
    source: 'mx' as const,
    state: 'approved' as const,
    version: 1,
  }
  const service = new MailPolicyService({
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    mxResolver: {
      resolve: async () => {
        resolverCalls += 1
        await lookupReleased
        return { exchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'], kind: 'resolved' as const }
      },
    },
    repository: {
      evaluate: async () => stored ? allowed : unlisted,
      storeAssessment: async () => { stored = true },
    } as never,
  })

  const first = service.evaluate('company.ru')
  const second = service.evaluate('company.ru')
  await Promise.resolve()
  releaseLookup()

  await expect(Promise.all([first, second])).resolves.toEqual([allowed, allowed])
  expect(resolverCalls).toBe(1)
})

test('normalizes only the domain boundary without applying provider alias rules', () => {
  expect(normalizeEmailDomain(' Yandex.RU. ')).toBe('yandex.ru')
  expect(normalizeEmailDomain('почта.рф')).toMatch(/^xn--[a-z0-9-]+\.xn--p1ai$/)
  expect(() => normalizeEmailDomain('https://yandex.ru')).toThrow()
  expect(() => normalizeEmailDomain('localhost')).toThrow()
})
