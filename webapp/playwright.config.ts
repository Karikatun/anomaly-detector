import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { e2eBackendEnv } from './e2e/env'
import { applyE2ePortEnv, resolveE2ePorts } from './e2e/ports'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(frontendRoot, '..')
const backendRoot = resolve(repositoryRoot, 'backend')
const websiteRoot = resolve(repositoryRoot, 'website')

const portPlan = await resolveE2ePorts()
applyE2ePortEnv(portPlan)

const backendPort = portPlan.backendPort
const frontendPort = portPlan.webPort
const backendUrl = portPlan.backendUrl
const frontendUrl = portPlan.webUrl
const websitePort = portPlan.websitePort
const websiteUrl = portPlan.websiteUrl
const databaseUrl = portPlan.databaseUrl

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

const backendEnv = normalizeEnv(e2eBackendEnv({
  PORT: String(backendPort),
  DATABASE_URL: databaseUrl,
  CORS_ORIGINS: [frontendUrl, 'http://localhost:5173'].join(','),
  WEBAPP_ORIGIN: frontendUrl,
}))

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  testDir: './e2e/specs',
  outputDir: './e2e/.artifacts/test-results',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.artifacts/report' }]],
  use: {
    baseURL: frontendUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'backend',
      command: 'bun run start',
      cwd: backendRoot,
      env: backendEnv,
      url: `${backendUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'web',
      command: `bun run dev --host 127.0.0.1 --port ${frontendPort}`,
      cwd: frontendRoot,
      env: normalizeEnv({
        ...process.env,
        VITE_API_URL: backendUrl,
        VITE_AGENTATION_ENABLED: process.env.UX_AUDIT_DIR ? 'true' : 'false',
        VITE_BUILD_SHA: process.env.VITE_BUILD_SHA ?? 'e'.repeat(40),
      }),
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'website',
      command: `bun run dev --ignore-lock --host 127.0.0.1 --port ${websitePort}`,
      cwd: websiteRoot,
      env: normalizeEnv({
        ...process.env,
        // Playwright owns this process; disable Astro's agent-only background daemon.
        ASTRO_DEV_BACKGROUND: '0',
        PUBLIC_WEBSITE_URL: websiteUrl,
        PUBLIC_WEBAPP_URL: frontendUrl,
      }),
      url: websiteUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
