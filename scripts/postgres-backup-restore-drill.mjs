import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repositoryHash } from './repo-env.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const backendRoot = resolve(repositoryRoot, 'backend')
const projectName = `anomaly-detector-${repositoryHash}-backup-drill-${process.pid}`
const sourceDatabase = 'anomaly_detector_test'
const restoredDatabase = 'anomaly_detector_restore_test'
const dumpPath = '/tmp/anomaly-detector-backup-restore-drill.dump'
const marker = 'backup-restore-drill'
const commandTimeoutMs = 5 * 60_000
const cleanupTimeoutMs = 30_000
const childTerminationGraceMs = 250
const postgresProbeTimeoutMs = 5_000
const composeArgs = backupDrillComposeArgs(
  resolve(repositoryRoot, 'docker-compose.yml'),
  projectName,
)
const isolatedEnvironmentKeys = [
  'POSTGRES_TEST_PORT',
]
const isolatedEnvironmentPrefixes = ['COMPOSE_', 'DOCKER_']
let composeEnv = backupDrillProcessEnvironment(process.env, {
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_TEST_PORT: '0',
})

let composeStarted = false
let cleaningUp = false
let cleanupOutcome
let cleanupPromise
let activeChild
let shutdownExitCode

export function backupDrillComposeArgs(composeFile, composeProjectName) {
  return ['compose', '--file', composeFile, '--project-name', composeProjectName]
}

export function backupDrillProcessEnvironment(baseEnvironment, overrides) {
  const environment = { ...baseEnvironment }
  for (const name of Object.keys(environment)) {
    if (
      isolatedEnvironmentKeys.includes(name)
      || isolatedEnvironmentPrefixes.some((prefix) => name.startsWith(prefix))
    ) delete environment[name]
  }
  return { ...environment, ...overrides }
}

export function localDockerEndpointFromContextInspect(output) {
  let contexts
  try {
    contexts = JSON.parse(output)
  } catch {
    throw new Error('PostgreSQL backup/restore drill requires valid Docker context JSON')
  }

  const endpoint = contexts?.[0]?.Endpoints?.docker?.Host
  if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) {
    throw new Error(
      'PostgreSQL backup/restore drill requires a local Unix-socket Docker context',
    )
  }
  return endpoint
}

export function backupDrillEvidence({
  cleanupConfirmed,
  completedAt,
  migrationCount,
  probeCount,
  startedAt,
}) {
  if (cleanupConfirmed !== true) {
    throw new Error('PostgreSQL backup/restore drill evidence requires confirmed cleanup')
  }
  return {
    artifactRetention: 'ephemeral_cleanup_confirmed',
    backupFormat: 'custom',
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    evidenceVersion: 1,
    kind: 'postgres_backup_restore_drill',
    migrationCount: Number(migrationCount),
    probeCount: Number(probeCount),
    recoveryPoint: 'post_migration_synthetic_probe',
    scope: 'local_isolated',
    startedAt: startedAt.toISOString(),
  }
}

async function run(command, args, options = {}) {
  if (shutdownExitCode !== undefined) throw new Error('PostgreSQL drill command interrupted')
  let result
  try {
    result = await executeCommand(command, args, options)
  } catch {
    throw new Error(`${command} ${args.join(' ')} could not start`)
  }
  if (shutdownExitCode !== undefined) throw new Error('PostgreSQL drill command interrupted')

  if (result.timedOut) {
    throw new Error(
      `${command} ${args.join(' ')} timed out after ${options.timeoutMs ?? commandTimeoutMs}ms`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`,
    )
  }

  return options.capture ? result.stdout.trim() : ''
}

async function executeCommand(command, args, options = {}) {
  const capture = options.capture === true
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    detached: process.platform !== 'win32',
    env: options.env ?? composeEnv,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : options.silent ? 'ignore' : 'inherit',
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

async function composeExec(args, options = {}) {
  return run(
    'docker',
    [...composeArgs, 'exec', '-T', 'postgres_test', ...args],
    options,
  )
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (shutdownExitCode !== undefined) {
      throw new Error('PostgreSQL drill database wait interrupted')
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
        sourceDatabase,
      ],
      { silent: true, timeoutMs: postgresProbeTimeoutMs },
    )

    if (result.status === 0) return
    if (result.timedOut) {
      throw new Error('Timed out probing the isolated PostgreSQL drill instance')
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  throw new Error('Timed out waiting for the isolated PostgreSQL drill instance')
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    if (!composeStarted) return { attempted: false, succeeded: true }
    cleaningUp = true
    process.stdout.write('Cleaning up the isolated drill environment...\n')
    try {
      const result = await executeCommand(
        'docker',
        [...composeArgs, 'down', '-v', '--remove-orphans'],
        { silent: true, timeoutMs: cleanupTimeoutMs },
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
      process.stdout.write('Cleanup confirmed for isolated drill environment.\n')
    }
    return cleanupOutcome
  })()
  return cleanupPromise
}

function databaseUrl(port, database) {
  return `postgresql://superuser:superpassword@localhost:${port}/${database}?schema=public`
}

async function main() {
  const startedAt = new Date()
  const isolatedBaseEnvironment = backupDrillProcessEnvironment(process.env, {})
  let dockerContext
  try {
    dockerContext = await executeCommand('docker', ['context', 'inspect'], {
      capture: true,
      env: isolatedBaseEnvironment,
      timeoutMs: 15_000,
    })
  } catch {
    throw new Error('PostgreSQL backup/restore drill could not inspect the local Docker context')
  }
  if (shutdownExitCode !== undefined) throw new Error('PostgreSQL drill interrupted')
  if (dockerContext.status !== 0) {
    throw new Error('PostgreSQL backup/restore drill could not inspect the local Docker context')
  }
  const localDockerEndpoint = localDockerEndpointFromContextInspect(dockerContext.stdout)
  composeEnv = backupDrillProcessEnvironment(isolatedBaseEnvironment, {
    COMPOSE_PROJECT_NAME: projectName,
    DOCKER_HOST: localDockerEndpoint,
    POSTGRES_TEST_PORT: '0',
  })

  process.stdout.write(`Starting isolated backup/restore drill (${projectName})...\n`)
  composeStarted = true
  await run('docker', [...composeArgs, 'up', '-d', 'postgres_test'])
  await waitForPostgres()

  const portOutput = await run(
    'docker',
    [...composeArgs, 'port', 'postgres_test', '5432'],
    { capture: true },
  )
  const port = portOutput.match(/:(\d+)\s*$/)?.[1]
  if (!port) {
    throw new Error(`Could not determine the isolated PostgreSQL port from "${portOutput}"`)
  }

  const sourceUrl = databaseUrl(port, sourceDatabase)
  await run('bun', ['run', 'prisma:deploy'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: sourceUrl },
  })

  await composeExec([
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'superuser',
    '-d',
    sourceDatabase,
    '-c',
    `CREATE TABLE backup_restore_probe (marker text PRIMARY KEY); INSERT INTO backup_restore_probe(marker) VALUES ('${marker}');`,
  ])

  const sourceMigrationCount = await composeExec(
    [
      'psql',
      '-At',
      '-U',
      'superuser',
      '-d',
      sourceDatabase,
      '-c',
      'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;',
    ],
    { capture: true },
  )

  await composeExec([
    'pg_dump',
    '-U',
    'superuser',
    '-d',
    sourceDatabase,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${dumpPath}`,
  ])
  await composeExec([
    'createdb',
    '-U',
    'superuser',
    '--template=template0',
    '--encoding=UTF8',
    restoredDatabase,
  ])
  await composeExec([
    'pg_restore',
    '-U',
    'superuser',
    '-d',
    restoredDatabase,
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    dumpPath,
  ])

  const restoredMarkerCount = await composeExec(
    [
      'psql',
      '-At',
      '-U',
      'superuser',
      '-d',
      restoredDatabase,
      '-c',
      `SELECT count(*) FROM backup_restore_probe WHERE marker = '${marker}';`,
    ],
    { capture: true },
  )
  const restoredMigrationCount = await composeExec(
    [
      'psql',
      '-At',
      '-U',
      'superuser',
      '-d',
      restoredDatabase,
      '-c',
      'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;',
    ],
    { capture: true },
  )

  if (restoredMarkerCount !== '1') {
    throw new Error(`Restored probe mismatch: expected 1 row, got ${restoredMarkerCount}`)
  }
  if (sourceMigrationCount === '0' || restoredMigrationCount !== sourceMigrationCount) {
    throw new Error(
      `Migration history mismatch: source=${sourceMigrationCount}, restored=${restoredMigrationCount}`,
    )
  }

  await run('bun', ['run', 'prisma', 'migrate', 'status'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(port, restoredDatabase),
    },
  })

  return {
    migrationCount: restoredMigrationCount,
    probeCount: restoredMarkerCount,
    startedAt,
  }
}

function cleanupFailureDiagnostic(outcome) {
  if (!outcome.attempted) {
    return 'PostgreSQL backup/restore drill cleanup was not attempted.'
  }
  if (outcome.timedOut) {
    return `PostgreSQL backup/restore drill cleanup timed out after ${cleanupTimeoutMs}ms.`
  }
  return `PostgreSQL backup/restore drill cleanup failed with exit code ${outcome.exitCode ?? 'unknown'}.`
}

async function runDrill() {
  let operationEvidence
  let operationError
  try {
    operationEvidence = await main()
  } catch (error) {
    operationError = error
  }

  const cleanupResult = await cleanup()
  if (shutdownExitCode !== undefined) return
  if (operationError) {
    process.stderr.write(`${operationError instanceof Error ? operationError.message : String(operationError)}\n`)
    process.exitCode = 1
  }
  if (!cleanupResult.succeeded || (operationEvidence && !cleanupResult.attempted)) {
    process.stderr.write(`${cleanupFailureDiagnostic(cleanupResult)}\n`)
    process.exitCode = 1
  }
  if (
    !operationError
    && cleanupResult.attempted
    && cleanupResult.succeeded
    && operationEvidence
  ) {
    const evidence = backupDrillEvidence({
      ...operationEvidence,
      cleanupConfirmed: true,
      completedAt: new Date(),
    })
    process.stdout.write(
      `Backup/restore drill passed: probe restored and ${evidence.migrationCount} migrations verified.\n`,
    )
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
  }
}

async function shutdownOnSignal(exitCode) {
  if (shutdownExitCode !== undefined) return
  shutdownExitCode = exitCode
  if (!cleaningUp) await terminateActiveChild()
  const cleanupResult = await cleanup()
  if (!cleanupResult.succeeded) {
    process.stderr.write(`${cleanupFailureDiagnostic(cleanupResult)}\n`)
  }
  process.exit(exitCode)
}

if (import.meta.main) {
  process.on('SIGINT', () => {
    void shutdownOnSignal(130)
  })
  process.on('SIGTERM', () => {
    void shutdownOnSignal(143)
  })

  await runDrill()
}
