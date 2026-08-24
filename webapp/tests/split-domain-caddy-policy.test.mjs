import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  localizeRedirectPolicy,
  redirectPolicy,
  siteBlock,
} from '../e2e/split-domain-caddy-policy.mjs'

const target = readFileSync(resolve(import.meta.dirname, '../../deploy/yandex/Caddyfile.example'), 'utf8')
const rollback = readFileSync(
  resolve(import.meta.dirname, '../../deploy/yandex/Caddyfile.split-domain-rollback.example'),
  'utf8',
)

describe('split-domain edge policy reader', () => {
  test('reads target and rollback redirects from the versioned Caddy blocks', () => {
    expect(redirectPolicy(siteBlock(target, 'anomaly-detector.ru'), '@legacyPlayerRoutes')).toEqual({
      cacheControl: 'no-store',
      destinationOrigin: 'https://app.anomaly-detector.ru',
      status: 302,
    })
    expect(redirectPolicy(siteBlock(target, 'www.anomaly-detector.ru'))).toEqual({
      cacheControl: undefined,
      destinationOrigin: 'https://anomaly-detector.ru',
      status: 301,
    })
    expect(redirectPolicy(siteBlock(rollback, 'app.anomaly-detector.ru'))).toEqual({
      cacheControl: 'no-store',
      destinationOrigin: 'https://anomaly-detector.ru',
      status: 302,
    })
  })

  test('rejects redirects that do not preserve the full URI or leave the owned hosts', () => {
    expect(() => siteBlock(
      'app.anomaly-detector.ru {\n}',
      'anomaly-detector.ru',
    )).toThrow('Missing anomaly-detector.ru site block')
    expect(() => redirectPolicy('example.test {\nredir https://example.test permanent\n}'))
      .toThrow('Redirect must preserve the complete request URI')
    expect(() => localizeRedirectPolicy({
      cacheControl: undefined,
      destinationOrigin: 'https://attacker.example',
      status: 302,
    }, {
      'https://anomaly-detector.ru': 'https://anomaly-detector.localhost:64000',
    })).toThrow('Unrecognized redirect destination https://attacker.example')
  })
})
