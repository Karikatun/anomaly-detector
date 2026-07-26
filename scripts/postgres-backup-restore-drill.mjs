import { spawnSync } from 'node:child_process'
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
const composeArgs = ['compose', '-p', projectName]
const composeEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_TEST_PORT: '0',
}

let composeStarted = false
let cleaningUp = false

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? composeEnv,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr.trim() : ''
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`,
    )
  }

  return options.capture ? result.stdout.trim() : ''
}

function composeExec(args, options = {}) {
  return run(
    'docker',
    [...composeArgs, 'exec', '-T', 'postgres_test', ...args],
    options,
  )
}

async function waitForPostgres() {
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
        sourceDatabase,
      ],
      {
        cwd: repositoryRoot,
        env: composeEnv,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  throw new Error('Timed out waiting for the isolated PostgreSQL drill instance')
}

function cleanup() {
  if (!composeStarted || cleaningUp) return
  cleaningUp = true
  process.stdout.write('Cleaning up the isolated drill environment...\n')
  spawnSync('docker', [...composeArgs, 'down', '-v', '--remove-orphans'], {
    cwd: repositoryRoot,
    env: composeEnv,
    stdio: 'inherit',
  })
}

function databaseUrl(port, database) {
  return `postgresql://superuser:superpassword@localhost:${port}/${database}?schema=public`
}

async function main() {
  process.stdout.write(`Starting isolated backup/restore drill (${projectName})...\n`)
  composeStarted = true
  run('docker', [...composeArgs, 'up', '-d', 'postgres_test'])
  await waitForPostgres()

  const portOutput = run(
    'docker',
    [...composeArgs, 'port', 'postgres_test', '5432'],
    { capture: true },
  )
  const port = portOutput.match(/:(\d+)\s*$/)?.[1]
  if (!port) {
    throw new Error(`Could not determine the isolated PostgreSQL port from "${portOutput}"`)
  }

  const sourceUrl = databaseUrl(port, sourceDatabase)
  run('bun', ['run', 'prisma:deploy'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: sourceUrl },
  })

  composeExec([
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

  const sourceMigrationCount = composeExec(
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

  composeExec([
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
  composeExec([
    'createdb',
    '-U',
    'superuser',
    '--template=template0',
    '--encoding=UTF8',
    restoredDatabase,
  ])
  composeExec([
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

  const restoredMarkerCount = composeExec(
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
  const restoredMigrationCount = composeExec(
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

  run('bun', ['run', 'prisma', 'migrate', 'status'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(port, restoredDatabase),
    },
  })

  process.stdout.write(
    `Backup/restore drill passed: probe restored and ${restoredMigrationCount} migrations verified.\n`,
  )
}

process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.once('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  cleanup()
}
