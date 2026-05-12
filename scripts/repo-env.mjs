import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const repositoryHash = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)
export const composeProjectName =
  process.env.COMPOSE_PROJECT_NAME ?? `vibecoding-template-${repositoryHash}`
export const defaultPostgresTestPort =
  process.env.POSTGRES_TEST_PORT ?? String(30000 + (Number.parseInt(repositoryHash.slice(0, 6), 16) % 20000))

export function defaultTestDatabaseUrl(port = defaultPostgresTestPort) {
  return `postgresql://postgres:postgres@localhost:${port}/web_app_demo_test?schema=public`
}

export function composeEnv(extra = {}) {
  return {
    ...process.env,
    POSTGRES_TEST_PORT: defaultPostgresTestPort,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ...extra,
  }
}
