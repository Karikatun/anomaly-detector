import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const websiteRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const buildOutput = mkdtempSync(join(tmpdir(), 'anomaly-website-pwa-launch-'))
let html = ''

beforeAll(async () => {
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: websiteRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PUBLIC_WEBSITE_URL: 'https://anomaly-detector.ru',
      PUBLIC_WEBAPP_URL: 'https://app.anomaly-detector.ru',
      SPLIT_DOMAIN_BUILD_OUT_DIR: buildOutput,
    },
  })
  expect(build.status, build.stderr).toBe(0)
  html = await readFile(resolve(buildOutput, 'index.html'), 'utf8')
})

afterAll(() => {
  rmSync(buildOutput, { force: true, recursive: true })
})

test('keeps the public landing out of new PWA installs', () => {
  expect(html).not.toContain('rel="manifest"')
})

test('sends legacy standalone launches to the player application without redirecting a normal visit', () => {
  const launchScript = html.match(/<script>([^<]*display-mode: standalone[^<]*)<\/script>/)?.[1]
  expect(launchScript).toBeDefined()

  expect(runLaunchScript(launchScript, { displayModeStandalone: true, iosStandalone: false }))
    .toEqual(['https://app.anomaly-detector.ru/'])
  expect(runLaunchScript(launchScript, { displayModeStandalone: false, iosStandalone: true }))
    .toEqual(['https://app.anomaly-detector.ru/'])
  expect(runLaunchScript(launchScript, { displayModeStandalone: false, iosStandalone: false })).toEqual([])
  expect(runLaunchScript(launchScript, {
    displayModeStandalone: true,
    iosStandalone: false,
    origin: 'https://app.anomaly-detector.ru',
  })).toEqual([])
})

test('does not emit a standalone redirect without a configured player origin', async () => {
  const output = mkdtempSync(join(tmpdir(), 'anomaly-website-pwa-unconfigured-'))
  const environment = { ...process.env, SPLIT_DOMAIN_BUILD_OUT_DIR: output }
  delete environment.PUBLIC_WEBSITE_URL
  delete environment.PUBLIC_WEBAPP_URL

  try {
    const build = spawnSync('bun', ['run', 'build'], {
      cwd: websiteRoot,
      encoding: 'utf8',
      env: environment,
    })
    expect(build.status, build.stderr).toBe(0)
    const unconfiguredHtml = await readFile(resolve(output, 'index.html'), 'utf8')
    expect(unconfiguredHtml).not.toContain('display-mode: standalone')
  } finally {
    rmSync(output, { force: true, recursive: true })
  }
})

function runLaunchScript(script, { displayModeStandalone, iosStandalone, origin = 'https://anomaly-detector.ru' }) {
  const redirects = []
  const window = {
    location: { origin, replace: (url) => redirects.push(url) },
    matchMedia: () => ({ matches: displayModeStandalone }),
    navigator: { standalone: iosStandalone },
  }

  new Function('window', script)(window)
  return redirects
}
