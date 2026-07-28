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
