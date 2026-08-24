import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertExcludesLocalServiceOrigins,
  disabledWebappAnalyticsEnvironment,
  disabledWebsiteAnalyticsEnvironment,
  withoutEnvironment,
} from './split-domain-preflight-support.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const productionApiOrigin = 'https://api.anomaly-detector.ru'
const productionRootOrigin = 'https://anomaly-detector.ru'
const productionAppOrigin = 'https://app.anomaly-detector.ru'
const fixtureBuildSha = '0123456789abcdef0123456789abcdef01234567'

run('bun', [
  'test',
  'scripts/yandex-caddy-security.test.mjs',
  'scripts/split-domain-preflight-support.test.mjs',
  'backend/src/env.test.ts',
  'backend/src/modules/auth/transport/routes.test.ts',
  'webapp/tests/e2e-env.test.ts',
  'webapp/tests/release-config.test.ts',
  'webapp/tests/split-domain-caddy-policy.test.mjs',
  'webapp/tests/split-domain-run.test.mjs',
  'webapp/tests/split-domain-tls.test.mjs',
  'website/tests/release-config.test.mjs',
  'website/tests/public-landing.test.mjs',
])

run('bun', ['run', '--cwd', 'webapp', 'e2e:split-domain'])

const releaseOutputRoot = mkdtempSync(join(tmpdir(), 'anomaly-split-preflight-'))
try {
  const webappOutputDirectory = resolve(releaseOutputRoot, 'webapp')
  const websiteOutputDirectory = resolve(releaseOutputRoot, 'website')
  run('bun', ['run', '--cwd', 'webapp', 'build:release'], {
    SPLIT_DOMAIN_BUILD_OUT_DIR: webappOutputDirectory,
    VITE_API_URL: productionApiOrigin,
    VITE_BUILD_SHA: fixtureBuildSha,
    VITE_OAUTH_API_URL: productionApiOrigin,
    VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE: 'PREFLIGHT TEST FIXTURE — OWNER APPROVAL REQUIRED',
    VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS: 'PREFLIGHT TEST FIXTURE — OWNER VALUE REQUIRED',
    VITE_PUBLIC_LEGAL_OPERATOR_NAME: 'PREFLIGHT TEST FIXTURE',
    VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT: 'PREFLIGHT TEST FIXTURE',
  }, disabledWebappAnalyticsEnvironment)
  run('bun', ['run', '--cwd', 'website', 'build:release'], {
    PUBLIC_WEBAPP_URL: productionAppOrigin,
    PUBLIC_WEBSITE_URL: productionRootOrigin,
    SPLIT_DOMAIN_BUILD_OUT_DIR: websiteOutputDirectory,
  }, disabledWebsiteAnalyticsEnvironment)

  const webappOutput = readTextOutput(webappOutputDirectory)
  assertIncludes(webappOutput, productionApiOrigin, 'webapp release output API origin')
  assertIncludes(webappOutput, fixtureBuildSha, 'webapp release output build SHA')
  assertExcludesTestServiceOrigins(webappOutput, 'webapp release output')

  const websiteOutput = readTextOutput(websiteOutputDirectory)
  for (const expected of [
    `<link rel="canonical" href="${productionRootOrigin}/">`,
    `${productionAppOrigin}/?continue=tutorial`,
    `${productionAppOrigin}/terms`,
    `${productionAppOrigin}/privacy`,
    `${productionAppOrigin}/personal-data-consent`,
  ]) {
    assertIncludes(websiteOutput, expected, 'website release output')
  }
  assertExcludesTestServiceOrigins(websiteOutput, 'website release output')
  assertExcludes(websiteOutput, 'data-analytics-consent', 'website release output')

  console.log('Split-domain preflight PASS.')
  console.log('Test-only release artifacts were isolated and removed; rebuild owner artifacts separately.')
} finally {
  rmSync(releaseOutputRoot, { force: true, recursive: true })
}

function run(command, args, extraEnvironment = {}, unsetEnvironment = []) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: withoutEnvironment(process.env, extraEnvironment, unsetEnvironment),
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`Preflight command failed: ${command} ${args.join(' ')}`)
  }
}

function readTextOutput(directory) {
  const textExtensions = new Set([
    '.css',
    '.html',
    '.js',
    '.json',
    '.map',
    '.svg',
    '.txt',
    '.webmanifest',
    '.xml',
  ])
  const values = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) values.push(readTextOutput(path))
    if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      values.push(readFileSync(path, 'utf8'))
    }
  }
  return values.join('\n')
}

function assertIncludes(output, expected, label) {
  if (!output.includes(expected)) throw new Error(`${label} is missing ${expected}`)
}

function assertExcludesTestServiceOrigins(output, label) {
  assertExcludesLocalServiceOrigins(output, label)
}

function assertExcludes(output, unexpected, label) {
  if (output.includes(unexpected)) throw new Error(`${label} unexpectedly contains ${unexpected}`)
}
