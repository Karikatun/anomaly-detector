import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const webappRoot = resolve(import.meta.dir, '..')

test('main E2E uses two bounded file workers without parallelizing tests inside a spec', () => {
  const config = loadConfig('./playwright.config.ts')

  expect(config).toEqual({ fullyParallel: false, workers: 2 })
})

test('main E2E accepts an explicit worker count up to four', () => {
  const config = loadConfig('./playwright.config.ts', { E2E_WORKERS: '4' })

  expect(config).toEqual({ fullyParallel: false, workers: 4 })
})

test('main E2E rejects worker overrides outside the bounded positive integer range', () => {
  for (const value of ['0', '5', '1.5', 'many']) {
    const result = probeConfig('./playwright.config.ts', { E2E_WORKERS: value })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('E2E_WORKERS must be an integer from 1 to 4')
  }
})

test('UX audit mode keeps one worker so browser projects cannot overwrite shared artifacts', () => {
  const config = loadConfig('./playwright.config.ts', {
    E2E_WORKERS: '4',
    UX_AUDIT_DIR: '/tmp/anomaly-e2e-ux-audit',
  })

  expect(config).toEqual({ fullyParallel: false, workers: 1 })
})

test('split-domain E2E remains single-worker even when the main-suite override is present', () => {
  const config = loadConfig('./playwright.split-domain.config.ts', {
    COMPOSE_PROJECT_NAME: 'anomaly-split-config-contract-target',
    E2E_SPLIT_DOMAIN_MODE: 'target',
    E2E_WORKERS: '4',
  })

  expect(config).toEqual({ fullyParallel: false, workers: 1 })
})

function loadConfig(configPath: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const result = probeConfig(configPath, extraEnv)

  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as { fullyParallel: boolean; workers: number }
}

function probeConfig(configPath: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const env = {
    ...process.env,
    E2E_BACKEND_PORT: '50001',
    E2E_EDGE_PORT: '64001',
    E2E_WEB_PORT: '55001',
    E2E_WEBSITE_PORT: '60001',
    TEST_DATABASE_URL:
      'postgresql://superuser:superpassword@localhost:54330/anomaly_detector_test?schema=public',
    ...extraEnv,
  }
  delete env.DATABASE_URL
  if (!Object.hasOwn(extraEnv, 'E2E_WORKERS')) delete env.E2E_WORKERS
  if (!Object.hasOwn(extraEnv, 'UX_AUDIT_DIR')) delete env.UX_AUDIT_DIR

  const result = spawnSync(process.execPath, [
    '-e',
    `import config from ${JSON.stringify(configPath)}; process.stdout.write(JSON.stringify({ fullyParallel: config.fullyParallel, workers: config.workers }))`,
  ], {
    cwd: webappRoot,
    encoding: 'utf8',
    env,
  })

  return result
}
