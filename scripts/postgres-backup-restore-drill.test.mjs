import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import {
  backupDrillComposeArgs,
  backupDrillEvidence,
  backupDrillProcessEnvironment,
  localDockerEndpointFromContextInspect,
} from './postgres-backup-restore-drill.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('PostgreSQL backup/restore drill isolation', () => {
  test('pins the repository Compose file and invocation-scoped project', () => {
    expect(backupDrillComposeArgs(
      '/repo/docker-compose.yml',
      'anomaly-backup-drill-test',
    )).toEqual([
      'compose',
      '--file',
      '/repo/docker-compose.yml',
      '--project-name',
      'anomaly-backup-drill-test',
    ])
  })

  test('removes ambient Docker and Compose selectors before applying drill-owned values', () => {
    const environment = backupDrillProcessEnvironment({
      COMPOSE_ENV_FILES: '/tmp/foreign.env',
      COMPOSE_FILE: '/tmp/foreign-compose.yml',
      COMPOSE_PROFILES: 'foreign',
      COMPOSE_PROJECT_NAME: 'production',
      DOCKER_CERT_PATH: '/tmp/remote-docker-certificates',
      DOCKER_CONFIG: '/tmp/foreign-docker-config',
      DOCKER_CONTEXT: 'production',
      DOCKER_HOST: 'tcp://production.example:2376',
      DOCKER_API_VERSION: '1.24',
      DOCKER_TLS_VERIFY: '1',
      KEEP: 'value',
      POSTGRES_TEST_PORT: '5432',
    }, {
      COMPOSE_PROJECT_NAME: 'anomaly-backup-drill-test',
      DOCKER_HOST: 'unix:///Users/test/.docker/run/docker.sock',
      POSTGRES_TEST_PORT: '0',
    })

    expect(environment).toEqual({
      COMPOSE_PROJECT_NAME: 'anomaly-backup-drill-test',
      DOCKER_HOST: 'unix:///Users/test/.docker/run/docker.sock',
      KEEP: 'value',
      POSTGRES_TEST_PORT: '0',
    })
  })

  test('accepts only a local Unix-socket Docker context', () => {
    expect(localDockerEndpointFromContextInspect(JSON.stringify([{
      Endpoints: { docker: { Host: 'unix:///Users/test/.docker/run/docker.sock' } },
    }]))).toBe('unix:///Users/test/.docker/run/docker.sock')

    for (const host of [
      'tcp://production.example:2376',
      'ssh://operator@production.example',
      'unix://production.example/docker.sock',
    ]) {
      expect(() => localDockerEndpointFromContextInspect(JSON.stringify([{
        Endpoints: { docker: { Host: host } },
      }]))).toThrow('local Unix-socket Docker context')
    }
    expect(() => localDockerEndpointFromContextInspect('not-json')).toThrow(
      'valid Docker context JSON',
    )
  })

  test('builds bounded structured evidence for the local isolated drill', () => {
    expect(backupDrillEvidence({
      cleanupConfirmed: true,
      completedAt: new Date('2026-08-25T10:00:01.250Z'),
      migrationCount: '20',
      probeCount: '1',
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
    })).toEqual({
      artifactRetention: 'ephemeral_cleanup_confirmed',
      backupFormat: 'custom',
      completedAt: '2026-08-25T10:00:01.250Z',
      durationMs: 1_250,
      evidenceVersion: 1,
      kind: 'postgres_backup_restore_drill',
      migrationCount: 20,
      probeCount: 1,
      recoveryPoint: 'post_migration_synthetic_probe',
      scope: 'local_isolated',
      startedAt: '2026-08-25T10:00:00.000Z',
    })
    expect(() => backupDrillEvidence({
      cleanupConfirmed: false,
      completedAt: new Date('2026-08-25T10:00:01.250Z'),
      migrationCount: '20',
      probeCount: '1',
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
    })).toThrow('requires confirmed cleanup')
  })

  test('emits successful evidence only after cleanup is confirmed', () => {
    const result = runFakeDrill({ cleanupExitCode: 0 })

    expect(result.status).toBe(0)
    const cleanupIndex = result.stdout.indexOf('Cleanup confirmed for isolated drill environment.')
    const evidenceIndex = result.stdout.indexOf('"kind":"postgres_backup_restore_drill"')
    expect(cleanupIndex).toBeGreaterThan(-1)
    expect(evidenceIndex).toBeGreaterThan(cleanupIndex)
    const evidenceLine = result.stdout
      .split('\n')
      .find((line) => line.includes('"kind":"postgres_backup_restore_drill"'))
    expect(JSON.parse(evidenceLine)).toMatchObject({
      artifactRetention: 'ephemeral_cleanup_confirmed',
      scope: 'local_isolated',
    })
    expect(result.stderr).not.toContain('provider-secret=should-not-leak')
  })

  test('fails without successful evidence when cleanup cannot be confirmed', () => {
    const result = runFakeDrill({ cleanupExitCode: 23 })

    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('Backup/restore drill passed')
    expect(result.stdout).not.toContain('"kind":"postgres_backup_restore_drill"')
    expect(result.stderr).toBe(
      'PostgreSQL backup/restore drill cleanup failed with exit code 23.\n',
    )
  })

  test('starts exact-project cleanup promptly when SIGINT or SIGTERM interrupts an active drill command', async () => {
    for (const [signal, expectedExitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const result = await runFakeDrillInterruptedBySignal(signal)
      const startedProject = result.stdout.match(
        /Starting isolated backup\/restore drill \(([^)]+)\)/,
      )?.[1]

      expect(result.exitCode).toBe(expectedExitCode)
      expect(result.signal).toBeNull()
      expect(result.cleanupStartedAfterMs).toBeLessThan(1_500)
      expect(result.cleanupCommands).toHaveLength(1)
      expect(startedProject).toMatch(/^anomaly-detector-[a-f0-9]+-backup-drill-\d+$/)
      expect(result.cleanupCommands[0]).toBe(
        `compose --file ${resolve(repositoryRoot, 'docker-compose.yml')} --project-name ${startedProject} down -v --remove-orphans`,
      )
      expect(result.stderr).not.toContain('provider-secret=should-not-leak')
    }
  }, 10_000)
})

function runFakeDrill({ cleanupExitCode }) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'anomaly-backup-drill-test-'))
  const dockerPath = join(temporaryRoot, 'docker')
  const bunPath = join(temporaryRoot, 'bun')
  writeFileSync(dockerPath, [
    '#!/bin/sh',
    'command_line="$*"',
    'if [ "$command_line" = "context inspect" ]; then',
    "  printf '%s\\n' '[{\"Endpoints\":{\"docker\":{\"Host\":\"unix:///tmp/fake-docker.sock\"}}}]'",
    '  exit 0',
    'fi',
    'case "$command_line" in',
    '  *" port postgres_test 5432")',
    "    printf '%s\\n' '127.0.0.1:54321'",
    '    ;;',
    '  *\'SELECT count(*) FROM "_prisma_migrations"\'*)',
    "    printf '%s\\n' '20'",
    '    ;;',
    '  *"SELECT count(*) FROM backup_restore_probe"*)',
    "    printf '%s\\n' '1'",
    '    ;;',
    '  *" down -v --remove-orphans")',
    "    printf '%s\\n' 'provider-secret=should-not-leak' >&2",
    '    exit "${FAKE_DOCKER_CLEANUP_EXIT_CODE:-0}"',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  writeFileSync(bunPath, '#!/bin/sh\nexit 0\n')
  chmodSync(dockerPath, 0o755)
  chmodSync(bunPath, 0o755)

  try {
    return spawnSync(process.execPath, ['scripts/postgres-backup-restore-drill.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_DOCKER_CLEANUP_EXIT_CODE: String(cleanupExitCode),
        PATH: `${temporaryRoot}:${process.env.PATH ?? ''}`,
      },
    })
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

async function runFakeDrillInterruptedBySignal(signal) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'anomaly-backup-drill-signal-test-'))
  const cleanupMarker = join(temporaryRoot, 'cleanup-started')
  const dockerPath = join(temporaryRoot, 'docker')
  const commandPidMarker = join(temporaryRoot, 'command-pid')
  const commandReadyMarker = join(temporaryRoot, 'command-ready')
  const bunPath = join(temporaryRoot, 'bun')
  writeFileSync(dockerPath, [
    '#!/bin/sh',
    'command_line="$*"',
    'if [ "$command_line" = "context inspect" ]; then',
    "  printf '%s\\n' '[{\"Endpoints\":{\"docker\":{\"Host\":\"unix:///tmp/fake-docker.sock\"}}}]'",
    '  exit 0',
    'fi',
    'case "$command_line" in',
    '  *" port postgres_test 5432")',
    "    printf '%s\\n' '127.0.0.1:54321'",
    '    ;;',
    '  *" down -v --remove-orphans")',
    "    printf '%s\\n' \"$command_line\" >> \"$FAKE_DOCKER_CLEANUP_MARKER\"",
    '    sleep 0.2',
    "    printf '%s\\n' 'provider-secret=should-not-leak' >&2",
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  writeFileSync(bunPath, [
    '#!/bin/sh',
    "printf '%s\\n' \"$$\" > \"$FAKE_LONG_CHILD_PID\"",
    "printf '%s\\n' 'ready' > \"$FAKE_LONG_CHILD_READY\"",
    'exec sleep 20',
    '',
  ].join('\n'))
  chmodSync(dockerPath, 0o755)
  chmodSync(bunPath, 0o755)

  const output = { stderr: '', stdout: '' }
  const child = spawn(process.execPath, ['scripts/postgres-backup-restore-drill.mjs'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      FAKE_DOCKER_CLEANUP_MARKER: cleanupMarker,
      FAKE_LONG_CHILD_PID: commandPidMarker,
      FAKE_LONG_CHILD_READY: commandReadyMarker,
      PATH: `${temporaryRoot}:${process.env.PATH ?? ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.on('data', (chunk) => { output.stderr += chunk })

  try {
    await waitForFile(commandReadyMarker, 3_000)
    const signalStartedAt = performance.now()
    child.kill(signal)
    await waitForFile(cleanupMarker, 1_500)
    const cleanupStartedAfterMs = performance.now() - signalStartedAt
    child.kill(signal)
    const exit = await waitForProcessExit(child, 3_000)
    return {
      ...exit,
      cleanupCommands: readFileSync(cleanupMarker, 'utf8').trim().split('\n'),
      cleanupStartedAfterMs,
      stderr: output.stderr,
      stdout: output.stdout,
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    terminateRecordedProcess(commandPidMarker)
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

async function waitForFile(path, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (!existsSync(path)) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await Bun.sleep(20)
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ exitCode: child.exitCode, signal: child.signalCode })
  }
  return Promise.race([
    new Promise((resolveExit) => {
      child.once('close', (exitCode, signal) => resolveExit({ exitCode, signal }))
    }),
    Bun.sleep(timeoutMs).then(() => {
      throw new Error(`Timed out waiting ${timeoutMs}ms for child process exit`)
    }),
  ])
}

function terminateRecordedProcess(pidMarker) {
  if (!existsSync(pidMarker)) return
  const pid = Number(readFileSync(pidMarker, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}
