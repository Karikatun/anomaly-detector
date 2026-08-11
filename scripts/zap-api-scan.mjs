import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  personalDataConsentVersion,
  termsVersion,
} from '@anomaly-detector/contracts'
import {
  assertTestDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultPostgresTestPort,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  repositoryHash,
  repositoryRoot,
} from './repo-env.mjs'

const tools = JSON.parse(readFileSync(resolve(repositoryRoot, '.security/tools.json'), 'utf8'))
const imageName = process.env.ZAP_BACKEND_IMAGE ?? 'anomaly-detector-backend:zap'
const containerName = `anomaly-detector-zap-${repositoryHash}-${process.pid}`
const hostPort = process.env.ZAP_BACKEND_PORT ?? String(await findOpenPort())
const networkName = `${composeProjectName}_default`
const composeArgs = ['compose', '-p', composeProjectName]
const databaseUrlForHost = process.env.TEST_DATABASE_URL ?? defaultTestDatabaseUrl(defaultPostgresTestPort)
const databaseUrlForContainer =
  'postgresql://superuser:superpassword@postgres_test:5432/anomaly_detector_test?schema=public'
const reportDirectory = resolve(repositoryRoot, '.scratch/security/zap', String(process.pid))
const configuredFailureIds = new Set(
  readFileSync(resolve(repositoryRoot, '.zap/rules.tsv'), 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter(([, state]) => state === 'FAIL')
    .map(([id]) => id),
)
const dockerEnv = composeEnv({
  POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrlForHost),
})

assertTestDatabaseUrl(databaseUrlForHost)
assertTestDatabaseUrl(databaseUrlForContainer)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`)
  }
  return result
}

function findOpenPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port)
        else reject(new Error('Could not allocate a ZAP backend port'))
      })
    })
  })
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = run(
      'docker',
      [...composeArgs, 'exec', '-T', 'postgres_test', 'pg_isready', '-U', 'superuser', '-d', 'anomaly_detector_test'],
      { allowFailure: true, env: dockerEnv, stdio: 'ignore' },
    )
    if (result.status === 0) return
    await Bun.sleep(1_000)
  }
  throw new Error('Timed out waiting for the isolated ZAP PostgreSQL database')
}

async function waitForBackend() {
  const healthUrl = `http://127.0.0.1:${hostPort}/health/ready`
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(healthUrl)
      if (response.ok) return
    } catch {
      // Retry while the container starts.
    }
    await Bun.sleep(1_000)
  }
  run('docker', ['logs', containerName], { allowFailure: true })
  throw new Error(`Timed out waiting for ${healthUrl}`)
}

async function createScanSession() {
  const response = await fetch(`http://127.0.0.1:${hostPort}/api/auth/token/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'ZAP Security Scan',
      login: `zap-scan-${Date.now()}`,
      password: 'zap-scan-password-123',
      privacyConsent: true,
      privacyConsentVersion: personalDataConsentVersion,
      termsVersion,
    }),
  })
  if (response.status !== 201) {
    throw new Error(`Could not create the isolated ZAP session: HTTP ${response.status}`)
  }
  const body = await response.json()
  if (typeof body.accessToken !== 'string') throw new Error('ZAP session did not return an access token')
  return body.accessToken
}

async function writeSafeOpenApi() {
  const response = await fetch(`http://127.0.0.1:${hostPort}/openapi.json`)
  if (!response.ok) throw new Error(`Could not read OpenAPI: HTTP ${response.status}`)
  const document = await response.json()
  document.servers = [{ url: `http://${containerName}:3000` }]

  // Active DAST must not revoke its own session or exercise account deletion.
  delete document.paths?.['/api/auth/account']?.delete

  const path = resolve(reportDirectory, 'openapi.json')
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
  return path
}

function redactReports(secret) {
  for (const name of ['report.html', 'report.json', 'report.md']) {
    const path = resolve(reportDirectory, name)
    try {
      const source = readFileSync(path, 'utf8')
      writeFileSync(path, source.replaceAll(secret, '[REDACTED]'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function enforceConfiguredFailures() {
  const report = JSON.parse(readFileSync(resolve(reportDirectory, 'report.json'), 'utf8'))
  const failures = new Map()

  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (configuredFailureIds.has(String(value.pluginid))) {
      failures.set(String(value.pluginid), value.name ?? value.alert ?? 'Configured ZAP failure')
    }
    for (const child of Object.values(value)) visit(child)
  }

  visit(report)
  if (failures.size > 0) {
    const summary = [...failures].map(([id, name]) => `${id} ${name}`).join(', ')
    throw new Error(`ZAP found configured blocking alerts: ${summary}`)
  }
}

let accessToken
let scanResult
try {
  mkdirSync(reportDirectory, { recursive: true })
  chmodSync(reportDirectory, 0o777)
  run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], { env: dockerEnv })
  await waitForPostgres()
  run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrlForHost },
  })
  run('docker', ['build', '-f', 'backend/Dockerfile', '-t', imageName, '.'])
  run('docker', [
    'run', '-d',
    '--name', containerName,
    '--network', networkName,
    '-p', `127.0.0.1:${hostPort}:3000`,
    '-e', 'PORT=3000',
    '-e', `DATABASE_URL=${databaseUrlForContainer}`,
    '-e', `JWT_SECRET=${'0123456789abcdef'.repeat(4)}`,
    '-e', 'CORS_ORIGINS=https://web.example.com',
    '-e', 'COOKIE_SECURE=true',
    imageName,
  ])
  await waitForBackend()
  accessToken = await createScanSession()
  await writeSafeOpenApi()

  scanResult = run('docker', [
    'run', '--rm',
    '--network', networkName,
    '-e', 'ZAP_AUTH_HEADER=Authorization',
    '-e', `ZAP_AUTH_HEADER_VALUE=Bearer ${accessToken}`,
    '-e', `ZAP_AUTH_HEADER_SITE=${containerName}`,
    '--volume', `${reportDirectory}:/zap/wrk:rw`,
    tools.zap.image,
    'zap-api-scan.py',
    '-t', '/zap/wrk/openapi.json',
    '-f', 'openapi',
    '-I',
    '-T', '20',
    '-r', 'report.html',
    '-J', 'report.json',
    '-w', 'report.md',
  ], { allowFailure: true })
} finally {
  if (accessToken) redactReports(accessToken)
  run('docker', ['rm', '-f', containerName], { allowFailure: true, stdio: 'ignore' })
  run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
    allowFailure: true,
    env: dockerEnv,
  })
}

if (!scanResult || scanResult.status !== 0) {
  throw new Error(`ZAP API scan failed with exit code ${scanResult?.status ?? 1}`)
}
enforceConfiguredFailures()
process.stdout.write(`Redacted ZAP reports: ${reportDirectory}\n`)
