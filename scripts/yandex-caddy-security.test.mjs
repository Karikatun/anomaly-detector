import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const caddyfile = readFileSync(
  resolve(import.meta.dirname, '../deploy/yandex/Caddyfile.example'),
  'utf8',
)

test('Yandex VM Caddy config protects the browser application with security headers', () => {
  expect(caddyfile).toContain('anomaly-detector.ru {')
  expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"')
  expect(caddyfile).toContain('Content-Security-Policy "')
  expect(caddyfile).toContain("frame-ancestors 'none'")
  expect(caddyfile).toContain("object-src 'none'")
  expect(caddyfile).toContain('X-Content-Type-Options "nosniff"')
  expect(caddyfile).toContain('Referrer-Policy "no-referrer"')
  expect(caddyfile).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=()"')
  expect(caddyfile).toContain('X-Frame-Options "DENY"')
  expect(caddyfile).toContain('-Server')
})

test('Yandex VM Caddy config permits only the production API realtime origins', () => {
  expect(caddyfile).toContain(
    "connect-src 'self' https://api.anomaly-detector.ru wss://api.anomaly-detector.ru",
  )
})

test('Yandex VM Caddy config proxies the API through the Compose network', () => {
  expect(caddyfile).toContain('reverse_proxy api:3000')
  expect(caddyfile).not.toContain('reverse_proxy 127.0.0.1:3000')
})

test('Yandex VM Caddy config caches only fingerprinted player assets as immutable', () => {
  expect(caddyfile).toContain('@playerAssets path /assets/*')
  expect(caddyfile).toContain(
    'header @playerAssets Cache-Control "public, max-age=31536000, immutable"',
  )
  expect(caddyfile).toContain(
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
