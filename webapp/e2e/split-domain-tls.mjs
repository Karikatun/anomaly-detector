import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function createEphemeralTlsCertificate() {
  const directory = mkdtempSync(join(tmpdir(), 'anomaly-split-domain-'))
  const certificatePath = join(directory, 'certificate.pem')
  const privateKeyPath = join(directory, 'private-key.pem')
  const result = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-days',
    '2',
    '-keyout',
    privateKeyPath,
    '-out',
    certificatePath,
    '-subj',
    '/CN=anomaly-detector.localhost',
    '-addext',
    'subjectAltName=DNS:anomaly-detector.localhost,DNS:*.anomaly-detector.localhost,IP:127.0.0.1',
  ], { stdio: 'ignore' })
  if (result.status !== 0) {
    rmSync(directory, { force: true, recursive: true })
    throw new Error('Could not create the ephemeral split-domain E2E TLS certificate')
  }

  let cleaned = false
  return {
    directory,
    tls: {
      cert: readFileSync(certificatePath),
      key: readFileSync(privateKeyPath),
    },
    cleanup() {
      if (cleaned) return
      cleaned = true
      rmSync(directory, { force: true, recursive: true })
    },
  }
}
