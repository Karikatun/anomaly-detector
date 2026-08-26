import { spawn, spawnSync } from 'node:child_process'
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

import { describe, expect, test } from 'bun:test'

import { repositoryRoot } from './repo-env.mjs'

describe('local MVP acceptance runner cleanup', () => {
  test('routes Vite and Astro env loading to the harness-owned empty directory', () => {
    const environmentDirectory = mkdtempSync(join(tmpdir(), 'anomaly-mvp-env-test-'))
    try {
      const result = spawnSync(process.execPath, ['-e', [
        "const webappModule = await import('./webapp/vite.config.ts')",
        "const webappConfig = await webappModule.default({ command: 'serve', mode: 'development' })",
        "const websiteModule = await import('./website/astro.config.mjs')",
        "console.log(JSON.stringify({ webapp: webappConfig.envDir, website: websiteModule.default.vite.envDir }))",
      ].join(';')], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          LOCAL_MVP_ENV_DIR: environmentDirectory,
          WEBSITE_RELEASE_BUILD: 'false',
        },
      })

      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout.trim())).toEqual({
        webapp: environmentDirectory,
        website: environmentDirectory,
      })
    } finally {
      rmSync(environmentDirectory, { force: true, recursive: true })
    }
  })

  test('cleans the exact project and emits no evidence after partial startup fails', () => {
    const result = runFakeSmoke({ cleanupExitCode: 0, deployExitCode: 17 })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Cleanup подтверждён')
    expect(result.cleanupCommand).toMatch(
      /^compose --env-file .* --file .*docker-compose\.yml --project-name anomaly-mvp-[a-f0-9]+-\d+-[a-z0-9]+ down -v --remove-orphans$/,
    )
    expect(result.stdout).not.toContain('Evidence:')
    expect(result.stdout).not.toContain('Smoke PASS')
    expect(result.stderr).not.toContain('provider-secret')
  })

  test('fails closed without evidence and prints the exact project when cleanup fails', () => {
    const result = runFakeSmoke({ cleanupExitCode: 23, deployExitCode: 17 })
    const projectName = result.cleanupCommand.match(/--project-name ([^ ]+)/)?.[1]

    expect(result.status).toBe(1)
    expect(projectName).toMatch(/^anomaly-mvp-[a-f0-9]+-\d+-[a-z0-9]+$/)
    expect(result.stderr).toContain(`Exact Compose project: ${projectName}.`)
    expect(result.stdout).not.toContain('Smoke PASS')
    expect(result.stdout).not.toContain('Evidence:')
  })

  test('starts exact-project cleanup when SIGINT or SIGTERM interrupts an owned command', async () => {
    for (const [signal, expectedExitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const result = await runFakeSmokeInterrupted(signal)

      expect(result.exitCode).toBe(expectedExitCode)
      expect(result.signal).toBeNull()
      expect(result.cleanupStartedAfterMs).toBeLessThan(1_500)
      expect(result.cleanupCommand).toMatch(
        /^compose --env-file .* --file .*docker-compose\.yml --project-name anomaly-mvp-[a-f0-9]+-\d+-[a-z0-9]+ down -v --remove-orphans$/,
      )
      expect(result.stdout).not.toContain('Evidence:')
      expect(result.stderr).not.toContain('provider-secret')
    }
  }, 10_000)
})

function runFakeSmoke({ cleanupExitCode, deployExitCode }) {
  const fixture = createFakeRunnerFixture({
    cleanupExitCode,
    deployExitCode,
    pauseDuringGenerate: false,
  })
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/local-mvp-acceptance.mjs', '--players', '2', '--smoke'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fixture.root}:${process.env.PATH ?? ''}` },
      },
    )
    return {
      ...result,
      cleanupCommand: readFileSync(fixture.cleanupMarker, 'utf8').trim(),
    }
  } finally {
    rmSync(fixture.root, { force: true, recursive: true })
  }
}

async function runFakeSmokeInterrupted(signal) {
  const fixture = createFakeRunnerFixture({
    cleanupExitCode: 0,
    deployExitCode: 0,
    pauseDuringGenerate: true,
  })
  const output = { stderr: '', stdout: '' }
  const child = spawn(
    process.execPath,
    ['scripts/local-mvp-acceptance.mjs', '--players', '2', '--smoke'],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PATH: `${fixture.root}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.on('data', (chunk) => { output.stderr += chunk })

  try {
    await waitForFile(fixture.generateMarker, 3_000)
    const signalStartedAt = performance.now()
    child.kill(signal)
    await waitForFile(fixture.cleanupMarker, 1_500)
    const cleanupStartedAfterMs = performance.now() - signalStartedAt
    const exit = await waitForProcessExit(child, 3_000)
    return {
      ...exit,
      cleanupCommand: readFileSync(fixture.cleanupMarker, 'utf8').trim(),
      cleanupStartedAfterMs,
      stderr: output.stderr,
      stdout: output.stdout,
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    rmSync(fixture.root, { force: true, recursive: true })
  }
}

function createFakeRunnerFixture({ cleanupExitCode, deployExitCode, pauseDuringGenerate }) {
  const root = mkdtempSync(join(tmpdir(), 'anomaly-mvp-runner-test-'))
  const cleanupMarker = join(root, 'cleanup-command')
  const generateMarker = join(root, 'generate-started')

  writeFileSync(join(root, 'git'), [
    '#!/bin/sh',
    'case "$*" in',
    '  "rev-parse HEAD")',
    `    printf '%s\\n' '${'a'.repeat(40)}'`,
    '    exit 0',
    '    ;;',
    '  status*)',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 1',
    '',
  ].join('\n'))
  writeFileSync(join(root, 'docker'), [
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
    `    printf '%s\\n' "$command_line" > ${shellQuote(cleanupMarker)}`,
    `    exit ${cleanupExitCode}`,
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'))
  writeFileSync(join(root, 'bun'), [
    '#!/bin/sh',
    'command_line="$*"',
    'case "$command_line" in',
    '  *"prisma:generate"*)',
    ...(pauseDuringGenerate
      ? [
          `    printf '%s\\n' 'ready' > ${shellQuote(generateMarker)}`,
          '    exec sleep 20',
        ]
      : ['    exit 0']),
    '    ;;',
    '  *"prisma:deploy"*)',
    `    exit ${deployExitCode}`,
    '    ;;',
    'esac',
    'exit 1',
    '',
  ].join('\n'))
  for (const name of ['bun', 'docker', 'git']) chmodSync(join(root, name), 0o755)
  return { cleanupMarker, generateMarker, root }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
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
