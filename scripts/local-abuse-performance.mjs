import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repositoryHash } from './repo-env.mjs'
import {
  assertLocalTestDatabaseUrl,
  assertSafeLocalBenchmarkEvidence,
  localBenchmarkProcessEnvironment,
  localDockerEndpointFromContextInspect,
} from './local-abuse-performance-support.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const backendRoot = resolve(repositoryRoot, 'backend')
const composeFile = resolve(repositoryRoot, 'docker-compose.yml')
const invocationId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
const projectName = `anomaly-detector-${repositoryHash}-local-benchmark-${process.pid}-${invocationId}`
const databaseName = 'anomaly_detector_test'
const commandTimeoutMs = 5 * 60_000
const cleanupTimeoutMs = 30_000
const childTerminationGraceMs = 250
const postgresProbeTimeoutMs = 5_000
const composeArgs = [
  'compose',
  '--file',
  composeFile,
  '--project-name',
  projectName,
]

let composeStarted = false
let cleaningUp = false
let cleanupOutcome
let cleanupPromise
let activeChild
let shutdownExitCode
let composeEnvironment = localBenchmarkProcessEnvironment(process.env, {
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_TEST_PORT: '0',
})

async function run(command, args, options = {}) {
  if (shutdownExitCode !== undefined) throw new Error('Local benchmark command interrupted')
  let result
  try {
    result = await executeCommand(command, args, options)
  } catch {
    throw new Error(`${options.label ?? 'Local benchmark command'} could not start`)
  }
  if (shutdownExitCode !== undefined) throw new Error('Local benchmark command interrupted')
  if (result.timedOut) {
    throw new Error(
      `${options.label ?? 'Local benchmark command'} timed out after ${options.timeoutMs ?? commandTimeoutMs}ms`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? 'Local benchmark command'} failed with exit code ${result.status ?? 'unknown'}`,
    )
  }
  return options.capture ? result.stdout.trim() : ''
}

async function executeCommand(command, args, options = {}) {
  const capture = options.capture === true
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    detached: process.platform !== 'win32',
    env: options.env ?? composeEnvironment,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
  })
  activeChild = child
  let stderr = ''
  let stdout = ''
  if (capture) {
    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdout.on('data', (chunk) => { stdout += chunk })
  }

  let timedOut = false
  let timeout
  const completed = new Promise((resolveCommand, rejectCommand) => {
    child.once('error', rejectCommand)
    child.once('close', (status, signal) => resolveCommand({ signal, status }))
  })
  const timedCompletion = new Promise((resolveCommand) => {
    timeout = setTimeout(() => {
      timedOut = true
      void terminateChild(child).finally(() => {
        resolveCommand({ signal: null, status: null })
      })
    }, options.timeoutMs ?? commandTimeoutMs)
  })

  try {
    const result = await Promise.race([completed, timedCompletion])
    return { ...result, stderr, stdout, timedOut }
  } finally {
    clearTimeout(timeout)
    if (activeChild === child) activeChild = undefined
  }
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('close', onClose)
      resolveExit(exited)
    }
    const onClose = () => finish(true)
    const timeout = setTimeout(() => finish(childHasExited(child)), timeoutMs)
    child.once('close', onClose)
    if (childHasExited(child)) finish(true)
  })
}

async function terminateChild(child) {
  if (childHasExited(child)) return
  signalChild(child, 'SIGTERM')
  if (await waitForChildExit(child, childTerminationGraceMs)) return
  signalChild(child, 'SIGKILL')
  if (await waitForChildExit(child, childTerminationGraceMs)) return
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.stdin?.destroy()
  child.unref()
}

function signalChild(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {}
  }
  try {
    child.kill(signal)
  } catch {}
}

async function terminateActiveChild() {
  const child = activeChild
  if (child) await terminateChild(child)
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (shutdownExitCode !== undefined) {
      throw new Error('Local benchmark database wait interrupted')
    }
    const result = await executeCommand(
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
        databaseName,
      ],
      { timeoutMs: postgresProbeTimeoutMs },
    )
    if (result.status === 0) return
    if (result.timedOut) {
      throw new Error('Timed out probing the isolated local benchmark database')
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }
  throw new Error('Timed out waiting for the isolated local benchmark database')
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    if (!composeStarted) return { attempted: false, succeeded: true }
    cleaningUp = true
    process.stdout.write('Cleaning up isolated local benchmark...\n')
    try {
      const result = await executeCommand(
        'docker',
        [...composeArgs, 'down', '-v', '--remove-orphans'],
        { timeoutMs: cleanupTimeoutMs },
      )
      cleanupOutcome = {
        attempted: true,
        exitCode: result.status,
        succeeded: !result.timedOut && result.status === 0,
        timedOut: result.timedOut,
      }
    } catch {
      cleanupOutcome = {
        attempted: true,
        exitCode: null,
        succeeded: false,
        timedOut: false,
      }
    }
    if (cleanupOutcome.succeeded) {
      process.stdout.write('Cleanup confirmed for isolated local benchmark.\n')
    }
    return cleanupOutcome
  })()
  return cleanupPromise
}

function cleanupFailureDiagnostic(outcome) {
  if (!outcome.attempted) {
    return 'Local abuse/performance benchmark cleanup was not attempted.'
  }
  if (outcome.timedOut) {
    return `Local abuse/performance benchmark cleanup timed out after ${cleanupTimeoutMs}ms.`
  }
  return `Local abuse/performance benchmark cleanup failed with exit code ${outcome.exitCode ?? 'unknown'}.`
}

async function main() {
  const startedAt = new Date()
  const isolatedBaseEnvironment = localBenchmarkProcessEnvironment(process.env)
  let context
  try {
    context = await executeCommand('docker', ['context', 'inspect'], {
      capture: true,
      env: isolatedBaseEnvironment,
      timeoutMs: 15_000,
    })
  } catch {
    throw new Error('Local abuse/performance benchmark could not inspect the Docker context')
  }
  if (shutdownExitCode !== undefined) throw new Error('Local benchmark interrupted')
  if (context.status !== 0) {
    throw new Error('Local abuse/performance benchmark could not inspect the Docker context')
  }
  const localDockerEndpoint = localDockerEndpointFromContextInspect(context.stdout)
  composeEnvironment = localBenchmarkProcessEnvironment(isolatedBaseEnvironment, {
    COMPOSE_PROJECT_NAME: projectName,
    DOCKER_HOST: localDockerEndpoint,
    POSTGRES_TEST_PORT: '0',
  })

  process.stdout.write(`Starting isolated local benchmark (${projectName})...\n`)
  composeStarted = true
  await run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], {
    label: 'Isolated PostgreSQL startup',
  })
  await waitForPostgres()

  const portOutput = await run(
    'docker',
    [...composeArgs, 'port', 'postgres_test', '5432'],
    { capture: true, label: 'Isolated PostgreSQL port lookup' },
  )
  const port = portOutput.match(/^(?:127\.0\.0\.1|\[::1\]|localhost):(\d+)$/)?.[1]
  if (!port) throw new Error('Could not determine a loopback isolated PostgreSQL port')
  const databaseUrl = `postgresql://superuser:superpassword@localhost:${port}/${databaseName}?schema=public`
  assertLocalTestDatabaseUrl(databaseUrl)

  const databaseEnvironment = localBenchmarkProcessEnvironment(composeEnvironment, {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: databaseUrl,
  })
  await run('bun', ['run', 'prisma:deploy'], {
    cwd: backendRoot,
    env: databaseEnvironment,
    label: 'Prisma migration deploy',
  })
  const rawEvidence = await run(
    'bun',
    ['backend/scripts/local-abuse-performance.ts'],
    {
      capture: true,
      env: databaseEnvironment,
      label: 'Local abuse/performance driver',
    },
  )
  let driverEvidence
  try {
    driverEvidence = JSON.parse(rawEvidence)
  } catch {
    throw new Error('Local abuse/performance driver returned invalid JSON evidence')
  }
  assertSafeLocalBenchmarkEvidence(driverEvidence)
  return { driverEvidence, startedAt }
}

async function runBenchmark() {
  let operation
  let operationError
  try {
    operation = await main()
  } catch (error) {
    operationError = error
  }

  const cleanupResult = await cleanup()
  if (shutdownExitCode !== undefined) return
  if (operationError) {
    process.stderr.write(`${operationError instanceof Error ? operationError.message : 'Local benchmark failed'}\n`)
    process.exitCode = 1
  }
  if (!cleanupResult.succeeded || (operation && !cleanupResult.attempted)) {
    process.stderr.write(`${cleanupFailureDiagnostic(cleanupResult)}\n`)
    process.exitCode = 1
  }
  if (!operationError && operation && cleanupResult.attempted && cleanupResult.succeeded) {
    const completedAt = new Date()
    const evidence = {
      ...operation.driverEvidence,
      artifactRetention: 'ephemeral_cleanup_confirmed',
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - operation.startedAt.getTime(),
      kind: 'local_abuse_performance_benchmark',
      startedAt: operation.startedAt.toISOString(),
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
  }
}

async function shutdownOnSignal(exitCode) {
  if (shutdownExitCode !== undefined) return
  shutdownExitCode = exitCode
  if (!cleaningUp) await terminateActiveChild()
  const result = await cleanup()
  if (!result.succeeded) process.stderr.write(`${cleanupFailureDiagnostic(result)}\n`)
  process.exit(exitCode)
}

if (import.meta.main) {
  process.on('SIGINT', () => {
    void shutdownOnSignal(130)
  })
  process.on('SIGTERM', () => {
    void shutdownOnSignal(143)
  })
  await runBenchmark()
}
