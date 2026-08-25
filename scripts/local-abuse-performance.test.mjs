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
  LOCAL_ABUSE_PERFORMANCE_SCENARIOS,
  assertLocalTestDatabaseUrl,
  assertSafeLocalBenchmarkEvidence,
  localBenchmarkProcessEnvironment,
  localDockerEndpointFromContextInspect,
} from './local-abuse-performance-support.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('local abuse/performance benchmark safety', () => {
  test('accepts only loopback PostgreSQL targets whose database name ends in _test', () => {
    for (const url of [
      'postgresql://user:pass@localhost:5432/anomaly_detector_test?schema=public',
      'postgres://user:pass@127.0.0.1:5432/anomaly_detector_test',
      'postgresql://user:pass@[::1]:5432/anomaly_detector_test',
    ]) {
      expect(() => assertLocalTestDatabaseUrl(url)).not.toThrow()
    }

    for (const url of [
      'postgresql://user:pass@db.internal:5432/anomaly_detector_test',
      'postgresql://user:pass@127.0.0.2:5432/anomaly_detector_test',
      'postgresql://user:pass@localhost:5432/anomaly_detector',
      'postgresql://user:pass@localhost:5432/anomaly_detector_test?host=production.example',
      'https://localhost/anomaly_detector_test',
      'not-a-url',
    ]) {
      expect(() => assertLocalTestDatabaseUrl(url)).toThrow('local loopback *_test PostgreSQL')
    }
  })

  test('clears ambient Docker, Compose, database and provider selectors', () => {
    expect(localBenchmarkProcessEnvironment({
      COMPOSE_ENV_FILES: '/tmp/foreign.env',
      COMPOSE_FILE: '/tmp/foreign-compose.yml',
      COMPOSE_PROFILES: 'foreign',
      COMPOSE_PROJECT_NAME: 'production',
      COMPOSE_PROJECT_DIRECTORY: '/tmp/foreign-project',
      DATABASE_URL: 'postgresql://production.example/app',
      DOCKER_CERT_PATH: '/tmp/certs',
      DOCKER_CONFIG: '/tmp/foreign-docker-config',
      DOCKER_CONTEXT: 'production',
      DOCKER_HOST: 'tcp://production.example:2376',
      DOCKER_TLS_VERIFY: '1',
      HTTP_PROXY: 'http://foreign-proxy.example:8080',
      HTTPS_PROXY: 'http://foreign-proxy.example:8443',
      MAIL_SMTP_PASSWORD: 'provider-secret',
      NO_PROXY: '',
      POSTGRES_TEST_PORT: '5432',
      TEST_DATABASE_URL: 'postgresql://production.example/app_test',
      YANDEX_STORAGE_SECRET_ACCESS_KEY: 'storage-secret',
      all_proxy: 'http://foreign-proxy.example:1080',
      http_proxy: 'http://foreign-proxy.example:8080',
      https_proxy: 'http://foreign-proxy.example:8443',
      no_proxy: '',
      KEEP: 'value',
    }, {
      COMPOSE_PROJECT_NAME: 'anomaly-local-benchmark-test',
      DOCKER_HOST: 'unix:///tmp/docker.sock',
      POSTGRES_TEST_PORT: '0',
    })).toEqual({
      COMPOSE_PROJECT_NAME: 'anomaly-local-benchmark-test',
      DOCKER_HOST: 'unix:///tmp/docker.sock',
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
  })

  test('pins the current abuse and Argon scenario manifest', () => {
    expect(LOCAL_ABUSE_PERFORMANCE_SCENARIOS).toEqual([
      'auth_wrong_password_budget',
      'auth_shared_nat_budget',
      'authenticated_mutation_budget',
      'feedback_account_budget',
      'feedback_ip_budget',
      'room_join_budget',
      'tender_command_budget',
      'fake_mail_delivery_budget',
      'realtime_ticket_budget',
      'realtime_invalid_ticket_churn',
      'realtime_cross_instance_recovery',
      'realtime_subscription_cap',
      'argon2_new_hash',
      'argon2_wrong_password_verify',
      'argon2_unknown_account_verify',
      'argon2_opportunistic_rehash',
      'email_password_reset',
      'recovery_code_password_reset',
    ])
  })

  test('binds the versioned driver to the guard, loopback listeners and fake delivery', () => {
    const driver = readFileSync(
      resolve(repositoryRoot, 'backend/scripts/local-abuse-performance.ts'),
      'utf8',
    )

    expect(driver).toContain('assertLocalTestDatabaseUrl(databaseUrl)')
    expect(driver).toContain("hostname: '127.0.0.1'")
    expect(driver).toContain("MAIL_SMTP_ENABLED: 'false'")
    expect(driver).toContain('return server.stop(true)')
    for (const scenario of LOCAL_ABUSE_PERFORMANCE_SCENARIOS) {
      expect(driver).toContain(`${scenario}:`)
    }
  })

  test('keeps the benchmark driver inside the mandatory backend typecheck', () => {
    const backendTypeScript = JSON.parse(readFileSync(
      resolve(repositoryRoot, 'backend/tsconfig.json'),
      'utf8',
    ))

    expect(backendTypeScript.include).toContain('scripts/local-abuse-performance.ts')
  })

  test('driver rejects a query-parameter host override before opening PostgreSQL', () => {
    const unsafeTarget =
      'postgresql://user:pass@localhost:5432/anomaly_detector_test?host=production.example'
    const result = spawnSync(
      process.execPath,
      ['backend/scripts/local-abuse-performance.ts'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: unsafeTarget,
          TEST_DATABASE_URL: unsafeTarget,
        },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('requires a local loopback *_test PostgreSQL target')
    expect(result.stderr).not.toContain('production.example')
  })

  test('rejects incomplete or secret-bearing structured evidence', () => {
    const safe = fakeDriverEvidence()
    expect(assertSafeLocalBenchmarkEvidence(safe)).toBe(safe)

    expect(() => assertSafeLocalBenchmarkEvidence({
      ...safe,
      scenarioIds: safe.scenarioIds.slice(1),
    })).toThrow('scenario manifest')
    expect(() => assertSafeLocalBenchmarkEvidence({
      ...safe,
      leaked: { accessToken: 'must-not-appear' },
    })).toThrow('unsafe evidence key')
    for (const leaked of [
      { access_token: 'must-not-appear' },
      { 'refresh-token': 'must-not-appear' },
      { Recovery_Code: 'must-not-appear' },
    ]) {
      expect(() => assertSafeLocalBenchmarkEvidence({ ...safe, leaked })).toThrow(
        'unsafe evidence key',
      )
    }
    expect(() => assertSafeLocalBenchmarkEvidence({
      ...safe,
      leaked: 'postgresql://user:pass@localhost:5432/anomaly_detector_test',
    })).toThrow('unsafe evidence value')
    const jwtShapedValue = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJsb2NhbCJ9',
      'signature-value',
    ].join('.')
    expect(() => assertSafeLocalBenchmarkEvidence({
      ...safe,
      leaked: jwtShapedValue,
    })).toThrow('unsafe evidence value')
  })

  test('emits successful evidence only after isolated volume cleanup', () => {
    const result = runFakeBenchmark({ cleanupExitCode: 0 })

    expect(result.status).toBe(0)
    const cleanupIndex = result.stdout.indexOf('Cleanup confirmed for isolated local benchmark.')
    const evidenceIndex = result.stdout.indexOf('"kind":"local_abuse_performance_benchmark"')
    expect(cleanupIndex).toBeGreaterThan(-1)
    expect(evidenceIndex).toBeGreaterThan(cleanupIndex)
    expect(result.stderr).not.toContain('provider-secret=must-not-leak')
  })

  test('fails closed without evidence when cleanup cannot be confirmed', () => {
    const result = runFakeBenchmark({ cleanupExitCode: 23 })

    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('"kind":"local_abuse_performance_benchmark"')
    expect(result.stderr).toBe(
      'Local abuse/performance benchmark cleanup failed with exit code 23.\n',
    )
  })

  test('starts exact-project cleanup promptly when SIGINT or SIGTERM interrupts the active driver', async () => {
    for (const [signal, expectedExitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const result = await runFakeBenchmarkInterruptedBySignal(signal)
      const startedProject = result.stdout.match(
        /Starting isolated local benchmark \(([^)]+)\)/,
      )?.[1]

      expect(result.exitCode).toBe(expectedExitCode)
      expect(result.signal).toBeNull()
      expect(result.cleanupStartedAfterMs).toBeLessThan(1_500)
      expect(result.cleanupCommands).toHaveLength(1)
      expect(startedProject).toMatch(
        /^anomaly-detector-[a-f0-9]+-local-benchmark-\d+-[a-z0-9-]+$/,
      )
      expect(result.cleanupCommands[0]).toBe(
        `compose --file ${resolve(repositoryRoot, 'docker-compose.yml')} --project-name ${startedProject} down -v --remove-orphans`,
      )
      expect(result.stderr).not.toContain('provider-secret=must-not-leak')
    }
  }, 10_000)
})

function fakeDriverEvidence() {
  return {
    evidenceVersion: 1,
    kind: 'local_abuse_performance_driver',
    scope: 'local_isolated',
    scenarioIds: [...LOCAL_ABUSE_PERFORMANCE_SCENARIOS],
    scenarios: Object.fromEntries(LOCAL_ABUSE_PERFORMANCE_SCENARIOS.map((id) => [
      id,
      { assertionsPassed: true, durationMs: 1 },
    ])),
  }
}

function runFakeBenchmark({ cleanupExitCode }) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'anomaly-local-benchmark-test-'))
  const dockerPath = join(temporaryRoot, 'docker')
  const bunPath = join(temporaryRoot, 'bun')
  const evidence = JSON.stringify(fakeDriverEvidence()).replaceAll("'", "'\\''")
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
    "    printf '%s\\n' 'provider-secret=must-not-leak' >&2",
    '    exit "${FAKE_DOCKER_CLEANUP_EXIT_CODE:-0}"',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  writeFileSync(bunPath, [
    '#!/bin/sh',
    'case "$*" in',
    '  *"local-abuse-performance.ts")',
    `    printf '%s\\n' '${evidence}'`,
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  chmodSync(dockerPath, 0o755)
  chmodSync(bunPath, 0o755)

  try {
    return spawnSync(process.execPath, ['scripts/local-abuse-performance.mjs'], {
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

async function runFakeBenchmarkInterruptedBySignal(signal) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'anomaly-local-benchmark-signal-test-'))
  const cleanupMarker = join(temporaryRoot, 'cleanup-started')
  const dockerPath = join(temporaryRoot, 'docker')
  const driverPidMarker = join(temporaryRoot, 'driver-pid')
  const driverReadyMarker = join(temporaryRoot, 'driver-ready')
  const bunPath = join(temporaryRoot, 'bun')
  const evidence = JSON.stringify(fakeDriverEvidence()).replaceAll("'", "'\\''")
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
    "    printf '%s\\n' 'provider-secret=must-not-leak' >&2",
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  writeFileSync(bunPath, [
    '#!/bin/sh',
    'case "$*" in',
    '  *"local-abuse-performance.ts")',
    "    printf '%s\\n' \"$$\" > \"$FAKE_LONG_CHILD_PID\"",
    "    printf '%s\\n' 'ready' > \"$FAKE_LONG_CHILD_READY\"",
    '    exec sleep 20',
    '    ;;',
    'esac',
    `printf '%s\\n' '${evidence}'`,
    'exit 0',
    '',
  ].join('\n'))
  chmodSync(dockerPath, 0o755)
  chmodSync(bunPath, 0o755)

  const output = { stderr: '', stdout: '' }
  const child = spawn(process.execPath, ['scripts/local-abuse-performance.mjs'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      FAKE_DOCKER_CLEANUP_MARKER: cleanupMarker,
      FAKE_LONG_CHILD_PID: driverPidMarker,
      FAKE_LONG_CHILD_READY: driverReadyMarker,
      PATH: `${temporaryRoot}:${process.env.PATH ?? ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.on('data', (chunk) => { output.stderr += chunk })

  try {
    await waitForFile(driverReadyMarker, 3_000)
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
    terminateRecordedProcess(driverPidMarker)
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
