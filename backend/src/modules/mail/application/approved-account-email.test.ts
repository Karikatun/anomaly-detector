import { expect, test } from 'bun:test'

import type { MailPolicyDecision } from './ports'
import { createAccountEmailCanonicalizer } from './approved-account-email'

test('keeps the provider value separate from service-specific canonicalization', async () => {
  const evaluatedDomains: string[] = []
  const policy: { evaluate(emailDomain: string): Promise<MailPolicyDecision> } = {
    evaluate: async (emailDomain) => {
      evaluatedDomains.push(emailDomain)
      return {
        acceptsNewAddress: true,
        allowsRecoveryDelivery: true,
        canonicalization: {
          ignoreDots: true,
          localPartCaseInsensitive: true,
          stripPlusTag: true,
        },
        state: 'approved',
        version: 4,
      }
    },
  }
  const canonicalizer = createAccountEmailCanonicalizer(policy)

  await expect(canonicalizer.canonicalize('First.Last+campaign@ЯНДЕКС.РФ')).resolves.toEqual({
    canonicalKey: 'firstlast@xn--d1acpjx3f.xn--p1ai',
    providerValue: 'First.Last+campaign@xn--d1acpjx3f.xn--p1ai',
  })
  await expect(canonicalizer.canonicalizeForRecovery('First.Last+campaign@ЯНДЕКС.РФ'))
    .resolves.toEqual({
      canonicalKey: 'firstlast@xn--d1acpjx3f.xn--p1ai',
      policyVersion: 4,
      providerValue: 'First.Last+campaign@xn--d1acpjx3f.xn--p1ai',
    })
  expect(evaluatedDomains).toEqual([
    'xn--d1acpjx3f.xn--p1ai',
    'xn--d1acpjx3f.xn--p1ai',
  ])
})

test('never removes dots or plus aliases without a published service rule', async () => {
  const canonicalizer = createAccountEmailCanonicalizer({
    evaluate: async () => ({
      acceptsNewAddress: true,
      allowsRecoveryDelivery: true,
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      state: 'approved',
      version: 1,
    }),
  })

  await expect(canonicalizer.canonicalize('First.Last+campaign@Example.COM')).resolves.toEqual({
    canonicalKey: 'First.Last+campaign@example.com',
    providerValue: 'First.Last+campaign@example.com',
  })
})

test('keeps an unpublished provider address without inventing alias rules', async () => {
  const canonicalizer = createAccountEmailCanonicalizer({
    evaluate: async () => ({
      acceptsNewAddress: false,
      allowsRecoveryDelivery: false,
      canonicalization: null,
      state: 'unlisted',
      version: 0,
    }),
  })

  await expect(canonicalizer.canonicalize('not-an-email')).resolves.toBeNull()
  await expect(canonicalizer.canonicalize('First.Last+tag@Example.COM')).resolves.toEqual({
    canonicalKey: 'First.Last+tag@example.com',
    providerValue: 'First.Last+tag@example.com',
  })
  await expect(canonicalizer.canonicalizeForRecovery('First.Last+tag@Example.COM'))
    .resolves.toBeNull()
})
