import { createServer } from 'node:net'
import {
  preferredEdgePort,
  preferredBackendPort,
  preferredPostgresTestPort,
  preferredWebPort,
  preferredWebsitePort,
} from './env'
import { portFromUrl } from './url'

export type PortPlan = {
  backendPort: number
  backendUrl: string
  databaseUrl: string
  edgePort: number
  edgeUrl: string
  operationalMetricsPort: number
  postgresTestPort: number
  webPort: number
  webUrl: string
  workerHealthPort: number
  websitePort: number
  websiteUrl: string
}

export async function resolveE2ePorts(
  options: { reserveEdge?: boolean } = {},
): Promise<PortPlan> {
  const reservedPorts = new Set<number>()
  const explicitDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  const explicitPostgresPort = explicitDatabaseUrl
    ? parsePortValue(portFromUrl(explicitDatabaseUrl), explicitDatabaseUrl)
    : undefined
  const explicitBackendUrlPort = parsePortValue(
    portFromUrl(process.env.E2E_BACKEND_URL),
    process.env.E2E_BACKEND_URL ?? 'E2E_BACKEND_URL',
  )
  const explicitWebUrlPort = parsePortValue(
    portFromUrl(process.env.E2E_WEB_URL),
    process.env.E2E_WEB_URL ?? 'E2E_WEB_URL',
  )
  const explicitWebsiteUrlPort = parsePortValue(
    portFromUrl(process.env.E2E_WEBSITE_URL),
    process.env.E2E_WEBSITE_URL ?? 'E2E_WEBSITE_URL',
  )
  const explicitEdgeUrlPort = parsePortValue(
    portFromUrl(process.env.E2E_EDGE_URL),
    process.env.E2E_EDGE_URL ?? 'E2E_EDGE_URL',
  )
  const postgresTestPort = explicitPostgresPort
    ? reservePort(explicitPostgresPort, reservedPorts)
    : await resolvePort({
        envName: 'POSTGRES_TEST_PORT',
        preferredPort: preferredPostgresTestPort,
        reservedPorts,
      })
  const backendPort = explicitBackendUrlPort
    ? reserveBackendRuntimePorts(
        explicitBackendUrlPort,
        'E2E_BACKEND_URL',
        reservedPorts,
      )
    : await resolveBackendPort({
        envName: 'E2E_BACKEND_PORT',
        preferredPort: preferredBackendPort,
        reservedPorts,
      })
  const workerHealthPort = backendPort + 1
  const operationalMetricsPort = backendPort + 2
  const webPort = explicitWebUrlPort
    ? reservePort(explicitWebUrlPort, reservedPorts)
    : await resolvePort({
        envName: 'E2E_WEB_PORT',
        preferredPort: preferredWebPort,
        reservedPorts,
      })
  const websitePort = explicitWebsiteUrlPort
    ? reservePort(explicitWebsiteUrlPort, reservedPorts)
    : await resolvePort({
        envName: 'E2E_WEBSITE_PORT',
        preferredPort: preferredWebsitePort,
        reservedPorts,
      })
  const edgePort = explicitEdgeUrlPort
    ? reservePort(explicitEdgeUrlPort, reservedPorts)
    : options.reserveEdge
      ? await resolvePort({
        envName: 'E2E_EDGE_PORT',
        preferredPort: preferredEdgePort,
        reservedPorts,
      })
      : preferredEdgePort
  const backendUrl = process.env.E2E_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`
  const webUrl = process.env.E2E_WEB_URL ?? `http://127.0.0.1:${webPort}`
  const websiteUrl = process.env.E2E_WEBSITE_URL ?? `http://127.0.0.1:${websitePort}`
  const edgeUrl = process.env.E2E_EDGE_URL ?? `http://127.0.0.1:${edgePort}`
  const databaseUrl =
    explicitDatabaseUrl
    ?? `postgresql://superuser:superpassword@localhost:${postgresTestPort}/anomaly_detector_test?schema=public`

  return {
    backendPort,
    backendUrl,
    databaseUrl,
    edgePort,
    edgeUrl,
    operationalMetricsPort,
    postgresTestPort,
    webPort,
    webUrl,
    workerHealthPort,
    websitePort,
    websiteUrl,
  }
}

export function applyE2ePortEnv(plan: PortPlan) {
  process.env.OPERATIONAL_METRICS_PORT = String(plan.operationalMetricsPort)
  process.env.POSTGRES_TEST_PORT = String(plan.postgresTestPort)
  process.env.E2E_BACKEND_PORT = String(plan.backendPort)
  process.env.E2E_WEB_PORT ??= String(plan.webPort)
  process.env.E2E_BACKEND_URL ??= plan.backendUrl
  process.env.E2E_WEB_URL ??= plan.webUrl
  process.env.E2E_WEBSITE_PORT ??= String(plan.websitePort)
  process.env.E2E_WEBSITE_URL ??= plan.websiteUrl
  process.env.E2E_EDGE_PORT ??= String(plan.edgePort)
  process.env.E2E_EDGE_URL ??= plan.edgeUrl
  process.env.TEST_DATABASE_URL = plan.databaseUrl
  process.env.DATABASE_URL = plan.databaseUrl
  process.env.WORKER_HEALTH_PORT = String(plan.workerHealthPort)
}

async function resolveBackendPort(input: {
  envName: string
  preferredPort: number
  reservedPorts: Set<number>
}) {
  const explicitPort = process.env[input.envName]
  if (explicitPort !== undefined) {
    return reserveBackendRuntimePorts(
      parsePort(explicitPort, input.envName),
      input.envName,
      input.reservedPorts,
    )
  }

  for (let offset = 0; offset < 1_000; offset += 1) {
    const candidatePort = input.preferredPort + offset
    const runtimePorts = backendRuntimePorts(candidatePort, input.envName)
    if (runtimePorts.some((port) => input.reservedPorts.has(port))) continue
    const availability = await Promise.all(runtimePorts.map(isPortAvailable))
    if (availability.every(Boolean)) {
      for (const port of runtimePorts) input.reservedPorts.add(port)
      return candidatePort
    }
  }

  throw new Error(
    `Could not find three free ${input.envName} runtime ports near ${input.preferredPort}.`,
  )
}

async function resolvePort(input: {
  envName: string
  preferredPort: number
  reservedPorts: Set<number>
}) {
  const explicitPort = process.env[input.envName]
  if (explicitPort !== undefined) {
    const parsedPort = parsePort(explicitPort, input.envName)
    input.reservedPorts.add(parsedPort)
    return parsedPort
  }

  for (let offset = 0; offset < 1_000; offset += 1) {
    const candidatePort = input.preferredPort + offset
    if (input.reservedPorts.has(candidatePort)) continue
    if (await isPortAvailable(candidatePort)) {
      input.reservedPorts.add(candidatePort)
      return candidatePort
    }
  }

  throw new Error(`Could not find a free ${input.envName} port near ${input.preferredPort}.`)
}

function reservePort(port: number, reservedPorts: Set<number>) {
  reservedPorts.add(port)
  return port
}

function reserveBackendRuntimePorts(
  backendPort: number,
  envName: string,
  reservedPorts: Set<number>,
) {
  for (const port of backendRuntimePorts(backendPort, envName)) {
    reservedPorts.add(port)
  }
  return backendPort
}

function backendRuntimePorts(backendPort: number, envName: string) {
  if (backendPort > 65_533) {
    throw new Error(
      `${envName} must reserve three consecutive TCP ports for API, worker health, and operational metrics; got "${backendPort}" (maximum backend port is 65533).`,
    )
  }
  return [backendPort, backendPort + 1, backendPort + 2]
}

function parsePort(value: string, envName: string) {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${envName} must be a valid TCP port, got "${value}".`)
  }

  return port
}

function parsePortValue(value: string | undefined, envName: string) {
  if (value === undefined) return undefined
  return parsePort(value, envName)
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolveAvailability) => {
    const server = createServer()
    server.once('error', () => resolveAvailability(false))
    server.once('listening', () => {
      server.close(() => resolveAvailability(true))
    })
    server.listen({ host: '127.0.0.1', port })
  })
}
