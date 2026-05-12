import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const mobileRoot = resolve(scriptDir, '../..')
const flowPath = resolve(mobileRoot, '.maestro/flows/auth-smoke.yaml')
const configPath = resolve(mobileRoot, '.maestro/config.yaml')
const reportsRoot = resolve(mobileRoot, '.maestro/reports')
const runId = new Date().toISOString().replace(/[^0-9]/g, '')
const reportDir = resolve(reportsRoot, runId)

const testIds = {
  DASHBOARD_ID: 'auth.dashboard',
  EMAIL_INPUT_ID: 'auth.email-input',
  LOGOUT_BUTTON_ID: 'auth.logout-button',
  NAME_INPUT_ID: 'auth.name-input',
  PASSWORD_INPUT_ID: 'auth.password-input',
  SUBMIT_BUTTON_ID: 'auth.submit-button',
}

const appId = process.env.APP_ID ?? process.env.MAESTRO_APP_ID ?? 'com.webappdemo.mobile'
const email =
  process.env.E2E_EMAIL ??
  `mobile-e2e-${runId}-${Math.random().toString(36).slice(2, 8)}@example.com`
const displayName = process.env.E2E_DISPLAY_NAME ?? 'Mobile E2E User'
const password = process.env.E2E_PASSWORD ?? 'password123'
const apiHealthUrl =
  process.env.E2E_API_HEALTH_URL ??
  (process.env.EXPO_PUBLIC_API_URL
    ? `${process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')}/health`
    : undefined)

function resolveMaestroBin() {
  if (process.env.MAESTRO_BIN) {
    return process.env.MAESTRO_BIN
  }

  const defaultInstallPath = join(homedir(), '.maestro/bin/maestro')
  const probe = spawnSync(defaultInstallPath, ['--version'], { stdio: 'ignore' })

  if (probe.status === 0) {
    return defaultInstallPath
  }

  return 'maestro'
}

function assertMaestroInstalled(maestroBin) {
  const result = spawnSync(maestroBin, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    process.stderr.write(
      `${[
        'Maestro CLI is not ready for this shell.',
        'Install it with: curl -fsSL "https://get.maestro.mobile.dev" | bash',
        'Make sure Java 17+ is active and ~/.maestro/bin is on PATH, or set MAESTRO_BIN.',
        detail ? `Probe output:\n${detail}` : undefined,
      ]
        .filter(Boolean)
        .join('\n')}\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`Maestro ${result.stdout.trim()}\n`)
}

async function preflightApi() {
  if (process.env.MAESTRO_SKIP_API_PREFLIGHT === '1') {
    return
  }

  if (!apiHealthUrl) {
    process.stdout.write(
      'Skipping API preflight: set E2E_API_HEALTH_URL or EXPO_PUBLIC_API_URL to check backend reachability.\n',
    )
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await fetch(apiHealthUrl, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    process.stdout.write(`API preflight passed: ${apiHealthUrl}\n`)
  } catch (error) {
    process.stderr.write(
      `API preflight failed for ${apiHealthUrl}. Set E2E_API_HEALTH_URL to a host-reachable /health URL or MAESTRO_SKIP_API_PREFLIGHT=1 to skip intentionally.\n`,
    )
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}

mkdirSync(reportDir, { recursive: true })

const maestroBin = resolveMaestroBin()
assertMaestroInstalled(maestroBin)
await preflightApi()

const args = []

if (process.env.MAESTRO_DEVICE) {
  args.push('--device', process.env.MAESTRO_DEVICE)
}

args.push(
  'test',
  '--config',
  configPath,
  '--debug-output',
  resolve(reportDir, 'debug'),
  '--test-output-dir',
  resolve(reportDir, 'artifacts'),
  '-e',
  `APP_ID=${appId}`,
  '-e',
  `E2E_DISPLAY_NAME=${displayName}`,
  '-e',
  `E2E_EMAIL=${email}`,
  '-e',
  `E2E_PASSWORD=${password}`,
)

for (const [key, value] of Object.entries(testIds)) {
  args.push('-e', `${key}=${value}`)
}

args.push(flowPath)

process.stdout.write(`Running Maestro auth smoke against ${appId}\n`)
process.stdout.write(`Report directory: ${reportDir}\n`)

const result = spawnSync(maestroBin, args, {
  cwd: mobileRoot,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
