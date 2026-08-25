import { describe, expect, test } from 'bun:test'

import { MAX_CUSTOM_DOMAIN_MX_RECORDS } from '../application/mail-domain-classifier'
import { NodeMxResolver } from './node-mx-resolver'

describe('NodeMxResolver', () => {
  test('normalizes the queried domain and complete exchange set while ignoring priority', async () => {
    const requested: string[] = []
    const resolver = new NodeMxResolver({
      lookup: async (domain) => {
        requested.push(domain)
        return [
          { exchange: 'MX2.HOSTING.REG.RU.', priority: 50 },
          { exchange: 'mx1.hosting.reg.ru', priority: 10 },
        ]
      },
    })

    await expect(resolver.resolve('Пример.РФ.')).resolves.toEqual({
      exchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'],
      kind: 'resolved',
    })
    expect(requested).toEqual(['xn--e1afmkfd.xn--p1ai'])
  })

  test.each(['ENODATA', 'ENOTFOUND'])('maps %s to a stable no-MX result', async (code) => {
    const resolver = new NodeMxResolver({
      lookup: async () => {
        throw Object.assign(new Error('lookup failed'), { code })
      },
    })

    await expect(resolver.resolve('company.ru')).resolves.toEqual({ kind: 'no_mx' })
  })

  test('returns retry for a bounded timeout without exposing the provider error', async () => {
    const resolver = new NodeMxResolver({
      lookup: () => new Promise(() => {}),
      timeoutMs: 5,
    })

    await expect(resolver.resolve('company.ru')).resolves.toEqual({
      kind: 'retry',
      reason: 'dns_timeout',
    })
  })

  test('maps other resolver failures to a redacted retry result', async () => {
    const resolver = new NodeMxResolver({
      lookup: async () => {
        throw new Error('provider details that must not escape')
      },
    })

    await expect(resolver.resolve('company.ru')).resolves.toEqual({
      kind: 'retry',
      reason: 'dns_unavailable',
    })
  })

  test('fails closed for null, empty, excessive, invalid and invalid-domain responses', async () => {
    await expect(new NodeMxResolver({
      lookup: async () => [{ exchange: '.', priority: 0 }],
    }).resolve('company.ru')).resolves.toEqual({ kind: 'null_mx' })

    await expect(new NodeMxResolver({
      lookup: async () => [],
    }).resolve('company.ru')).resolves.toEqual({ kind: 'no_mx' })

    await expect(new NodeMxResolver({
      lookup: async () => Array.from(
        { length: MAX_CUSTOM_DOMAIN_MX_RECORDS + 1 },
        (_, index) => ({ exchange: `mx${index}.example.ru`, priority: index }),
      ),
    }).resolve('company.ru')).resolves.toEqual({ kind: 'too_many_records' })

    await expect(new NodeMxResolver({
      lookup: async () => [{ exchange: 'not a domain', priority: 10 }],
    }).resolve('company.ru')).resolves.toEqual({ kind: 'invalid_records' })

    const requested: string[] = []
    await expect(new NodeMxResolver({
      lookup: async (domain) => {
        requested.push(domain)
        return []
      },
    }).resolve('not a domain')).resolves.toEqual({ kind: 'invalid_records' })
    expect(requested).toEqual([])
  })
})
