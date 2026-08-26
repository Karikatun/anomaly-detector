import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { createPrisma } from '../../backend/src/db'
import {
  composeEnv,
  composeProjectName,
  defaultDatabaseUrl,
  e2eBackendEnv,
  repositoryRoot,
} from './env'
import {
  ensurePasswordRecoveryMailPolicy,
  shouldEnsurePasswordRecoveryMailPolicy,
} from './password-recovery-isolation'

const composeArgs = ['compose', '-p', composeProjectName]

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

async function waitForComposePostgres(service: string, database: string, env: NodeJS.ProcessEnv) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [...composeArgs, 'exec', '-T', service, 'pg_isready', '-U', 'superuser', '-d', database],
      {
        cwd: repositoryRoot,
        env,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  throw new Error(`Timed out waiting for Docker Compose service "${service}"`)
}

async function waitForPostgresPort(databaseUrl: string) {
  const { hostname, port } = new URL(databaseUrl)

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const isReady = await new Promise<boolean>((resolve) => {
      const socket = createConnection({
        host: hostname,
        port: Number(port || 5432),
      })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.setTimeout(1_000, () => {
        socket.destroy()
        resolve(false)
      })
    })

    if (isReady) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  throw new Error(`Timed out waiting for PostgreSQL at ${hostname}:${port || 5432}`)
}

async function waitForWorkerReady(worker: ReturnType<typeof spawn>, healthPort: number) {
  let spawnError: Error | undefined
  worker.once('error', (error) => {
    spawnError = error
  })

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (spawnError) {
      throw new Error(`E2E worker failed to start: ${spawnError.message}`)
    }
    if (worker.exitCode !== null) {
      throw new Error(`E2E worker exited before becoming ready with code ${worker.exitCode}`)
    }

    try {
      const response = await fetch(`http://127.0.0.1:${healthPort}/health/ready`)
      if (response.ok) return
    } catch {
      // The health server may not be listening yet.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }

  if (worker.exitCode === null) worker.kill('SIGTERM')
  throw new Error(`Timed out waiting for E2E worker readiness on port ${healthPort}`)
}

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultDatabaseUrl
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '')
  const backendPort = Number(process.env.E2E_BACKEND_PORT)
  const operationalMetricsPort = Number(process.env.OPERATIONAL_METRICS_PORT)
  const workerHealthPort = Number(process.env.WORKER_HEALTH_PORT)

  if (!databaseName.endsWith('_test') && process.env.E2E_ALLOW_NON_TEST_DATABASE !== '1') {
    throw new Error(
      `Refusing to run Playwright against non-test database "${databaseName}". Use a *_test database or set E2E_ALLOW_NON_TEST_DATABASE=1 intentionally.`,
    )
  }

  process.env.TEST_DATABASE_URL = databaseUrl
  process.env.DATABASE_URL = databaseUrl

  const env = composeEnv(e2eBackendEnv({
    DATABASE_URL: databaseUrl,
    OPERATIONAL_METRICS_PORT: String(operationalMetricsPort),
    PORT: String(backendPort),
    TEST_DATABASE_URL: databaseUrl,
    WORKER_HEALTH_PORT: String(workerHealthPort),
  }))

  if (process.env.E2E_SKIP_DOCKER !== '1') {
    run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], env)
    await waitForComposePostgres('postgres_test', 'anomaly_detector_test', env)
    await waitForPostgresPort(databaseUrl)
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], env)
      break
    } catch (error) {
      if (attempt === 3) throw error
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
    }
  }

  if (shouldEnsurePasswordRecoveryMailPolicy(process.env)) {
    const prisma = createPrisma(databaseUrl)
    try {
      await ensurePasswordRecoveryMailPolicy(prisma)
    } finally {
      await prisma.$disconnect()
    }
  }

  const worker = spawn('bun', ['run', '--cwd', 'backend', 'start:worker'], {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  })
  await waitForWorkerReady(worker, workerHealthPort)

  return async () => {
    if (worker.exitCode !== null) return
    worker.kill('SIGTERM')
    await Promise.race([
      once(worker, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
  }
}
