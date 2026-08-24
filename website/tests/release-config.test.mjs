import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadWebsiteReleaseEnvironment,
  validateWebsiteReleaseEnvironment,
} from '../release-config.mjs'

const validEnvironment = {
  PUBLIC_WEBSITE_URL: 'https://anomaly-detector.ru',
  PUBLIC_WEBAPP_URL: 'https://app.anomaly-detector.ru',
}

describe('website split-domain release environment', () => {
  test('accepts the exact public and player production origins', () => {
    expect(() => validateWebsiteReleaseEnvironment(validEnvironment)).not.toThrow()
  })

  test.each([
    ['PUBLIC_ANALYTICS_API_URL', 'https://api.anomaly-detector.ru'],
    ['PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST', 'launch_ru'],
  ])('rejects an ambient owner-gated %s value', (name, value) => {
    expect(() => validateWebsiteReleaseEnvironment({
      ...validEnvironment,
      [name]: value,
    })).toThrow(`${name} must be absent until production analytics is approved`)
  })

  test.each([
    ['PUBLIC_WEBSITE_URL', undefined],
    ['PUBLIC_WEBSITE_URL', 'https://www.anomaly-detector.ru'],
    ['PUBLIC_WEBSITE_URL', 'https://anomaly-detector.ru/path'],
    ['PUBLIC_WEBAPP_URL', undefined],
    ['PUBLIC_WEBAPP_URL', 'https://anomaly-detector.ru'],
    ['PUBLIC_WEBAPP_URL', 'https://app.anomaly-detector.ru/'],
  ])('rejects an unsafe %s value', (name, value) => {
    expect(() => validateWebsiteReleaseEnvironment({
      ...validEnvironment,
      [name]: value,
    })).toThrow(`${name} must equal`)
  })

  test('loads owner-gated public values from the same production env files as Astro', () => {
    const directory = mkdtempSync(join(tmpdir(), 'anomaly-website-release-env-'))
    const previous = process.env.PUBLIC_ANALYTICS_API_URL
    delete process.env.PUBLIC_ANALYTICS_API_URL
    try {
      writeFileSync(
        join(directory, '.env.production'),
        [
          'PUBLIC_WEBSITE_URL=https://anomaly-detector.ru',
          'PUBLIC_WEBAPP_URL=https://app.anomaly-detector.ru',
          'PUBLIC_ANALYTICS_API_URL=https://api.anomaly-detector.ru',
        ].join('\n'),
      )
      const loaded = loadWebsiteReleaseEnvironment(directory)

      expect(loaded.PUBLIC_ANALYTICS_API_URL).toBe('https://api.anomaly-detector.ru')
      expect(() => validateWebsiteReleaseEnvironment(loaded)).toThrow(
        'PUBLIC_ANALYTICS_API_URL must be absent until production analytics is approved',
      )
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_ANALYTICS_API_URL
      else process.env.PUBLIC_ANALYTICS_API_URL = previous
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
