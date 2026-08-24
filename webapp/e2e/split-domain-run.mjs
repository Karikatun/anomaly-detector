export function splitDomainComposeProjectName(invocationId, mode) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(invocationId)) {
    throw new Error('Split-domain invocation id must be a safe lowercase Compose name segment')
  }
  if (mode !== 'target' && mode !== 'rollback') {
    throw new Error('Split-domain mode must be target or rollback')
  }
  return `anomaly-split-${invocationId}-${mode}`
}

const isolatedEnvironmentKeys = [
  'COMPOSE_ENV_FILES',
  'COMPOSE_FILE',
  'COMPOSE_PROFILES',
  'DATABASE_URL',
  'DOCKER_CERT_PATH',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'E2E_ALLOW_NON_TEST_DATABASE',
  'E2E_BACKEND_PORT',
  'E2E_BACKEND_URL',
  'E2E_EDGE_PORT',
  'E2E_EDGE_URL',
  'E2E_KEEP_DOCKER',
  'E2E_SKIP_DOCKER',
  'E2E_WEB_PORT',
  'E2E_WEB_URL',
  'E2E_WEBSITE_PORT',
  'E2E_WEBSITE_URL',
  'POSTGRES_TEST_PORT',
  'SPLIT_DOMAIN_BUILD_OUT_DIR',
  'TEST_DATABASE_URL',
  'WEBAPP_RELEASE_BUILD',
  'WEBSITE_RELEASE_BUILD',
]

export function splitDomainProcessEnvironment(baseEnvironment, overrides) {
  const environment = { ...baseEnvironment }
  for (const name of isolatedEnvironmentKeys) delete environment[name]
  return { ...environment, ...overrides }
}

export function localDockerEndpointFromContextInspect(output) {
  let contexts
  try {
    contexts = JSON.parse(output)
  } catch {
    throw new Error('Split-domain E2E requires valid Docker context JSON')
  }

  const endpoint = contexts?.[0]?.Endpoints?.docker?.Host
  if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) {
    throw new Error('Split-domain E2E requires a local Unix-socket Docker context')
  }
  return endpoint
}
