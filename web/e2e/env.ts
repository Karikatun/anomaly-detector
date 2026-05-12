import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const repositoryHash = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)
export const composeProjectName =
  process.env.COMPOSE_PROJECT_NAME ?? `vibecoding-template-${repositoryHash}`
export const defaultPostgresTestPort =
  process.env.POSTGRES_TEST_PORT ?? String(30000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 20000))
export const defaultBackendPort =
  process.env.E2E_BACKEND_PORT ?? String(50000 + (Number.parseInt(repositoryHash.slice(6, 12), 16) % 5000))
export const defaultWebPort =
  process.env.E2E_WEB_PORT ?? String(55000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 5000))
export const defaultDatabaseUrl = `postgresql://postgres:postgres@localhost:${defaultPostgresTestPort}/web_app_demo_test?schema=public`

export function composeEnv(extra: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    POSTGRES_TEST_PORT: defaultPostgresTestPort,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ...extra,
  }
}
