import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
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
} from '../../scripts/repo-env.mjs'

const imageName = process.env.BACKEND_DOCKER_SMOKE_IMAGE ?? 'anomaly-detector-backend:smoke'
const containerName =
  process.env.BACKEND_DOCKER_SMOKE_CONTAINER ??
  `anomaly-detector-backend-smoke-${repositoryHash}-${process.pid}`
const hostPort = process.env.BACKEND_DOCKER_SMOKE_PORT ?? String(await findOpenPort())
let metricsHostPort = process.env.BACKEND_DOCKER_SMOKE_METRICS_PORT ?? String(await findOpenPort())
while (metricsHostPort === hostPort) metricsHostPort = String(await findOpenPort())
const networkName = `${composeProjectName}_default`
const composeArgs = ['compose', '-p', composeProjectName]
const databaseUrlForHost =
  process.env.TEST_DATABASE_URL ?? defaultTestDatabaseUrl(defaultPostgresTestPort)
const databaseUrlForContainer =
  process.env.BACKEND_DOCKER_SMOKE_DATABASE_URL ??
  'postgresql://superuser:superpassword@postgres_test:5432/anomaly_detector_test?schema=public'
assertTestDatabaseUrl(databaseUrlForHost)
assertTestDatabaseUrl(databaseUrlForContainer, {
  allowEnvName: 'BACKEND_DOCKER_SMOKE_ALLOW_NON_TEST_DATABASE',
})
const dockerEnv = composeEnv({
  POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrlForHost),
})

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`)
  }
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }

        reject(new Error('Could not allocate an open TCP port'))
      })
    })
  })
}

async function waitForComposePostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        ...composeArgs,
        'exec',
        '-T',
        'postgres_test',
        'pg_isready',
        '-U',
        'superuser',
        '-d',
        'anomaly_detector_test',
      ],
      {
        cwd: repositoryRoot,
        env: dockerEnv,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write('Timed out waiting for postgres_test\n')
  throw new Error('Timed out waiting for postgres_test')
}

async function waitForHealth() {
  const url = `http://127.0.0.1:${hostPort}/health/ready`

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        process.stdout.write(`Backend Docker smoke passed: ${url}\n`)
        return
      }
    } catch {
      // Retry until the container finishes booting.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write(`Timed out waiting for ${url}\n`)
  spawnSync('docker', ['logs', containerName], { stdio: 'inherit' })
  throw new Error(`Timed out waiting for ${url}`)
}

async function smokeAuthApi() {
  const baseUrl = `http://127.0.0.1:${hostPort}`
  const login = `docker-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const register = await fetch(`${baseUrl}/api/auth/token/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login,
      password: 'password123',
      displayName: 'Docker Smoke',
      privacyConsent: true,
      privacyConsentVersion: personalDataConsentVersion,
      termsAccepted: true,
      termsVersion,
    }),
  })

  if (register.status !== 201) {
    throw new Error(`Register failed with HTTP ${register.status}: ${await register.text()}`)
  }

  const registerBody = await register.json()
  if (!registerBody.accessToken || !registerBody.refreshToken) {
    throw new Error('Register response did not include mobile auth tokens')
  }

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${registerBody.accessToken}`,
    },
  })

  if (me.status !== 200) {
    throw new Error(`/me failed with HTTP ${me.status}: ${await me.text()}`)
  }

  process.stdout.write('Backend Docker DB-backed auth smoke passed\n')
}

async function smokePrivateMetricsBoundary() {
  const publicResponse = await fetch(`http://127.0.0.1:${hostPort}/metrics`)
  if (publicResponse.status !== 404) {
    throw new Error(`Public API unexpectedly exposed metrics with HTTP ${publicResponse.status}`)
  }

  const privateResponse = await fetch(`http://127.0.0.1:${metricsHostPort}/metrics`)
  const body = await privateResponse.text()
  if (!privateResponse.ok || !body.includes('anomaly_detector_api_up 1')) {
    throw new Error(`Private operational metrics failed with HTTP ${privateResponse.status}`)
  }

  process.stdout.write('Backend private operational metrics boundary passed\n')
}

try {
  run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], { env: dockerEnv })
  await waitForComposePostgres()

  run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlForHost,
    },
  })

  run('docker', ['build', '-f', 'backend/Dockerfile', '-t', imageName, '.'])
  run('docker', [
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    imageName,
    '-c',
    'test ! -f /app/backend/.env',
  ])
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })

  run('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '--network',
    networkName,
    '-p',
    `127.0.0.1:${hostPort}:3000`,
    '-p',
    `127.0.0.1:${metricsHostPort}:3002`,
    '-e',
    'PORT=3000',
    '-e',
    'OPERATIONAL_METRICS_HOST=0.0.0.0',
    '-e',
    'OPERATIONAL_METRICS_PORT=3002',
    '-e',
    `DATABASE_URL=${databaseUrlForContainer}`,
    '-e',
    `JWT_SECRET=${'0123456789abcdef'.repeat(4)}`,
    '-e',
    'CORS_ORIGINS=https://web.example.com',
    '-e',
    'WEBAPP_ORIGIN=https://web.example.com',
    '-e',
    'COOKIE_SECURE=true',
    imageName,
  ])

  await waitForHealth()
  await smokePrivateMetricsBoundary()
  await smokeAuthApi()
} finally {
  spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' })
  spawnSync('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
    cwd: repositoryRoot,
    env: dockerEnv,
    stdio: 'inherit',
  })
}
