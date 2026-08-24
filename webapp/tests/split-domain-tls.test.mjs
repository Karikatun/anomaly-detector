import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { createEphemeralTlsCertificate } from '../e2e/split-domain-tls.mjs'

test('ephemeral split-domain TLS material has an idempotent exact-directory cleanup', () => {
  const certificate = createEphemeralTlsCertificate()
  try {
    expect(existsSync(certificate.directory)).toBe(true)
    expect(certificate.tls.cert.byteLength).toBeGreaterThan(0)
    expect(certificate.tls.key.byteLength).toBeGreaterThan(0)
  } finally {
    certificate.cleanup()
  }
  certificate.cleanup()
  expect(existsSync(certificate.directory)).toBe(false)
})
