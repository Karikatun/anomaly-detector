import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { siteBlock } from '../webapp/e2e/split-domain-caddy-policy.mjs'

const caddyfile = readFileSync(
  resolve(import.meta.dirname, '../deploy/yandex/Caddyfile.example'),
  'utf8',
)
const webappRoutes = readFileSync(
  resolve(import.meta.dirname, '../webapp/src/routes.tsx'),
  'utf8',
)
const rollbackCaddyfile = readFileSync(
  resolve(import.meta.dirname, '../deploy/yandex/Caddyfile.split-domain-rollback.example'),
  'utf8',
)

const publicSite = siteBlock(caddyfile, 'anomaly-detector.ru')
const playerSite = siteBlock(caddyfile, 'app.anomaly-detector.ru')

test('Yandex VM Caddy config serves the public website without a private SPA fallback', () => {
  expect(publicSite).toContain('root * {$ANOMALY_WEBSITE_ROOT}')
  expect(publicSite).toContain('file_server')
  expect(publicSite).toContain('@websiteAssets path /_astro/*')
  expect(publicSite).not.toContain('root * {$ANOMALY_WEBAPP_ROOT}')
  expect(publicSite).not.toContain('try_files {path} /index.html')
  expect(publicSite).not.toContain('X-Robots-Tag "noindex')
  expect(publicSite).toContain('Content-Security-Policy "')
  expect(publicSite).toContain("frame-ancestors 'none'")
  expect(publicSite).toContain('X-Content-Type-Options "nosniff"')
})

test('Yandex VM Caddy config permits the public site to call only the first-party API', () => {
  expect(publicSite).toContain("connect-src 'self' https://api.anomaly-detector.ru")
  expect(publicSite).not.toMatch(/connect-src[^\"]*\*/)
})

test('Yandex VM Caddy config redirects only fixed legacy player route families', () => {
  const configuredRoutes = publicSite
    .match(/@legacyPlayerRoutes\s*{\s*path\s+([^\n]+)\s*}/)?.[1]
    ?.trim()
    .split(/\s+/)
    .sort()
  const registeredPlayerRoutes = [...webappRoutes.matchAll(/\bpath:\s*'([^']+)'/g)]
    .map(([, route]) => route)
    .filter((route) => route !== '/')
    .map((route) => route.replace(/\$[^/]+/g, '*'))
    .sort()

  expect(configuredRoutes).toEqual(registeredPlayerRoutes)
  expect(publicSite).toContain(
    'header @legacyPlayerRoutes Cache-Control "no-store"',
  )
  expect(publicSite).toContain(
    'redir @legacyPlayerRoutes https://app.anomaly-detector.ru{uri} temporary',
  )
  expect(caddyfile).toContain(
    'redir https://anomaly-detector.ru{uri} permanent',
  )
})

test('Yandex VM Caddy config protects and deindexes the player application', () => {
  expect(playerSite).toContain('root * {$ANOMALY_WEBAPP_ROOT}')
  expect(playerSite).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"')
  expect(playerSite).toContain('Content-Security-Policy "')
  expect(playerSite).toContain("frame-ancestors 'none'")
  expect(playerSite).toContain("object-src 'none'")
  expect(playerSite).toContain('X-Content-Type-Options "nosniff"')
  expect(playerSite).toContain('Referrer-Policy "no-referrer"')
  expect(playerSite).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"')
  expect(playerSite).toContain('X-Frame-Options "DENY"')
  expect(playerSite).toContain('X-Robots-Tag "noindex, nofollow, noarchive"')
  expect(playerSite).toContain('try_files {path} /index.html')
  expect(playerSite).toContain('-Server')
})

test('Yandex VM Caddy config permits only the production API realtime origins', () => {
  expect(playerSite).toContain(
    "connect-src 'self' https://api.anomaly-detector.ru wss://api.anomaly-detector.ru",
  )
})

test('Yandex VM Caddy config proxies the API through the Compose network', () => {
  expect(caddyfile).toContain('reverse_proxy api:3000')
  expect(caddyfile).not.toContain('reverse_proxy 127.0.0.1:3000')
})

test('Yandex VM Caddy config caches only fingerprinted player assets as immutable', () => {
  expect(playerSite).toContain('@playerAssets path /assets/*')
  expect(playerSite).toContain(
    'header @playerAssets Cache-Control "public, max-age=31536000, immutable"',
  )
  expect(playerSite).toContain(
    'header /index.html Cache-Control "public, max-age=0, must-revalidate"',
  )
})

test('Yandex VM Caddy config protects the separate operator application before serving files', () => {
  expect(caddyfile).toContain('ops.anomaly-detector.ru {')
  expect(caddyfile).toContain('basic_auth {')
  expect(caddyfile).toContain('{$ANOMALY_ADMIN_USER} {$ANOMALY_ADMIN_PASSWORD_HASH}')
  expect(caddyfile).toContain('root * {$ANOMALY_ADMIN_ROOT}')
  expect(caddyfile).toContain('X-Robots-Tag "noindex, nofollow, noarchive"')
})

test('split-domain rollback restores the root player SPA without touching API storage', () => {
  const rollbackRoot = siteBlock(rollbackCaddyfile, 'anomaly-detector.ru')
  const rollbackPlayer = siteBlock(rollbackCaddyfile, 'app.anomaly-detector.ru')

  expect(rollbackRoot).toContain('root * {$ANOMALY_WEBAPP_ROOT}')
  expect(rollbackRoot).not.toContain('{$ANOMALY_WEBSITE_ROOT}')
  expect(rollbackRoot).toContain('try_files {path} /index.html')
  expect(rollbackRoot).toContain('X-Robots-Tag "noindex, nofollow, noarchive"')
  expect(rollbackPlayer).toContain(
    'redir https://anomaly-detector.ru{uri} temporary',
  )
  expect(rollbackPlayer).toContain('header Cache-Control "no-store"')
  expect(rollbackCaddyfile).toContain('reverse_proxy api:3000')
  expect(rollbackCaddyfile).not.toMatch(/postgres|docker\s+(?:down|rm)|volume\s+(?:rm|prune)/i)
})
