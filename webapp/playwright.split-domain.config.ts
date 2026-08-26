import { defineConfig, devices, type WebServerConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { e2eBackendEnv } from './e2e/env'
import { applyE2ePortEnv, resolveE2ePorts } from './e2e/ports'

const mode = process.env.E2E_SPLIT_DOMAIN_MODE
if (mode !== 'target' && mode !== 'rollback') {
  throw new Error('E2E_SPLIT_DOMAIN_MODE must be target or rollback')
}

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = resolve(frontendRoot, '..')
const backendRoot = resolve(repositoryRoot, 'backend')
const portPlan = await resolveE2ePorts({ reserveEdge: true })
applyE2ePortEnv(portPlan)
const composeProjectName = process.env.COMPOSE_PROJECT_NAME
if (!composeProjectName) throw new Error('COMPOSE_PROJECT_NAME is required for split-domain E2E')
const artifactRoot = resolve(frontendRoot, 'e2e/.artifacts', `split-domain-${composeProjectName}`)

const rootOrigin = `https://anomaly-detector.localhost:${portPlan.edgePort}`
const appOrigin = `https://app.anomaly-detector.localhost:${portPlan.edgePort}`
const apiOrigin = `https://api.anomaly-detector.localhost:${portPlan.edgePort}`
const untrustedOrigin = `https://untrusted.anomaly-detector.localhost:${portPlan.edgePort}`
const wwwOrigin = `https://www.anomaly-detector.localhost:${portPlan.edgePort}`
const playerOrigin = mode === 'target' ? appOrigin : rootOrigin

Object.assign(process.env, {
  E2E_SPLIT_API_ORIGIN: apiOrigin,
  E2E_SPLIT_APP_ORIGIN: appOrigin,
  E2E_SPLIT_ROOT_ORIGIN: rootOrigin,
  E2E_SPLIT_UNTRUSTED_ORIGIN: untrustedOrigin,
  E2E_SPLIT_WWW_ORIGIN: wwwOrigin,
})

function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

const backendEnv = normalizeEnv(e2eBackendEnv({
  ANALYTICS_CAMPAIGN_ALLOWLIST: '',
  ANALYTICS_ENABLED: 'false',
  ANALYTICS_ORIGINS: '',
  COOKIE_SECURE: 'true',
  CORS_ORIGINS: [playerOrigin, `https://ops.anomaly-detector.localhost:${portPlan.edgePort}`].join(','),
  DATABASE_URL: portPlan.databaseUrl,
  JWT_SECRET: '01'.repeat(32),
  OAUTH_CALLBACK_BASE_URL: apiOrigin,
  PORT: String(portPlan.backendPort),
  WEBAPP_ORIGIN: playerOrigin,
  YANDEX_OAUTH_CLIENT_ID: 'split-domain-e2e-client',
  YANDEX_OAUTH_CLIENT_SECRET: 'split-domain-e2e-secret',
}))

const webServers: WebServerConfig[] = [
  {
    name: 'backend',
    command: 'bun run start',
    cwd: backendRoot,
    env: backendEnv,
    url: `${portPlan.backendUrl}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  {
    name: 'web',
    command: 'bun e2e/static-build-server.mjs webapp',
    cwd: frontendRoot,
    env: normalizeEnv({
      ...process.env,
      E2E_STATIC_PORT: String(portPlan.webPort),
      SPLIT_DOMAIN_BUILD_OUT_DIR: resolve(artifactRoot, 'webapp'),
      VITE_API_URL: apiOrigin,
      VITE_ANALYTICS_ENABLED: '',
      VITE_BUILD_SHA: 'e'.repeat(40),
      VITE_OAUTH_API_URL: apiOrigin,
    }),
    url: portPlan.webUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
]

if (mode === 'target') {
  webServers.push({
    name: 'website',
    command: 'bun e2e/static-build-server.mjs website',
    cwd: frontendRoot,
    env: normalizeEnv({
      ...process.env,
      ASTRO_DEV_BACKGROUND: '0',
      E2E_STATIC_PORT: String(portPlan.websitePort),
      SPLIT_DOMAIN_BUILD_OUT_DIR: resolve(artifactRoot, 'website'),
      PUBLIC_WEBSITE_URL: rootOrigin,
      PUBLIC_WEBAPP_URL: appOrigin,
      PUBLIC_ANALYTICS_API_URL: '',
      PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST: '',
    }),
    url: portPlan.websiteUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  })
}

webServers.push({
  name: 'split-domain-edge',
  command: 'bun e2e/split-domain-edge.mjs',
  cwd: frontendRoot,
  env: normalizeEnv(process.env),
  url: `https://127.0.0.1:${portPlan.edgePort}/__ready`,
  ignoreHTTPSErrors: true,
  reuseExistingServer: false,
  timeout: 120_000,
})

export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: resolve(artifactRoot, 'test-results'),
  projects: [
    {
      name: `chromium-${mode}`,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--host-resolver-rules=MAP anomaly-detector.localhost 127.0.0.1, MAP *.anomaly-detector.localhost 127.0.0.1',
          ],
        },
      },
    },
  ],
  reporter: [['list']],
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e/split-domain',
  testMatch: mode === 'target' ? 'target.spec.ts' : 'rollback.spec.ts',
  timeout: 90_000,
  use: {
    baseURL: playerOrigin,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: webServers,
  workers: 1,
})
