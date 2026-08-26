export const LOCAL_ABUSE_PERFORMANCE_SCENARIOS = Object.freeze([
  'auth_wrong_password_budget',
  'auth_shared_nat_budget',
  'authenticated_mutation_budget',
  'feedback_account_budget',
  'feedback_ip_budget',
  'room_join_budget',
  'tender_command_budget',
  'fake_mail_delivery_budget',
  'realtime_ticket_budget',
  'realtime_invalid_ticket_churn',
  'realtime_cross_instance_recovery',
  'realtime_subscription_cap',
  'argon2_new_hash',
  'argon2_wrong_password_verify',
  'argon2_unknown_account_verify',
  'argon2_opportunistic_rehash',
  'email_password_reset',
  'recovery_code_password_reset',
])

const isolatedEnvironmentKeys = new Set([
  'ALL_PROXY',
  'DATABASE_URL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'TEST_DATABASE_URL',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
])
const isolatedEnvironmentPrefixes = [
  'COMPOSE_',
  'DOCKER_',
  'MAIL_SMTP_',
  'OAUTH_',
  'POSTGRES_',
  'YANDEX_OAUTH_',
  'YANDEX_STORAGE_',
]
const sensitiveEvidenceKeys = new Set([
  'accessToken',
  'authorization',
  'canonicalKey',
  'clientAddress',
  'codeHash',
  'connectionString',
  'cookie',
  'databaseUrl',
  'deviceToken',
  'email',
  'fingerprint',
  'ipAddress',
  'login',
  'messageId',
  'password',
  'passwordHash',
  'providerMessageId',
  'providerValue',
  'publicNumber',
  'recipient',
  'recoveryCode',
  'refreshToken',
  'roomCode',
  'secret',
  'sessionId',
  'sourceUrl',
  'ticket',
  'tenderId',
  'token',
  'tokenHash',
  'url',
  'userId',
].map(normalizeEvidenceKey))
const unsafeEvidenceValue = /(?:postgres(?:ql)?:\/\/|https?:\/\/|wss?:\/\/|\$argon2|Bearer\s|[^\s@]+@[^\s@]+|[?&#](?:token|ticket)=|\b[0-9a-f]{32,}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b)/i

export function assertLocalTestDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl)
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'
    const safeQuery = [...url.searchParams].every(
      ([name, value]) => name === 'schema' && value === 'public',
    )
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol)
      || !loopback
      || !databaseName.endsWith('_test')
      || !safeQuery
    ) {
      throw new Error('unsafe target')
    }
  } catch {
    throw new Error(
      'Local abuse/performance benchmark requires a local loopback *_test PostgreSQL target',
    )
  }
}

export function localBenchmarkProcessEnvironment(baseEnvironment, overrides = {}) {
  const environment = { ...baseEnvironment }
  for (const name of Object.keys(environment)) {
    if (
      isolatedEnvironmentKeys.has(name)
      || isolatedEnvironmentPrefixes.some((prefix) => name.startsWith(prefix))
    ) {
      delete environment[name]
    }
  }
  return { ...environment, ...overrides }
}

export function localDockerEndpointFromContextInspect(output) {
  let contexts
  try {
    contexts = JSON.parse(output)
  } catch {
    throw new Error('Local abuse/performance benchmark requires valid Docker context JSON')
  }

  const endpoint = contexts?.[0]?.Endpoints?.docker?.Host
  if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) {
    throw new Error(
      'Local abuse/performance benchmark requires a local Unix-socket Docker context',
    )
  }
  return endpoint
}

export function assertSafeLocalBenchmarkEvidence(evidence) {
  if (!isRecord(evidence)
    || evidence.evidenceVersion !== 1
    || evidence.kind !== 'local_abuse_performance_driver'
    || evidence.scope !== 'local_isolated') {
    throw new Error('Local benchmark driver returned an invalid evidence envelope')
  }
  if (
    !Array.isArray(evidence.scenarioIds)
    || evidence.scenarioIds.length !== LOCAL_ABUSE_PERFORMANCE_SCENARIOS.length
    || evidence.scenarioIds.some(
      (value, index) => value !== LOCAL_ABUSE_PERFORMANCE_SCENARIOS[index],
    )
  ) {
    throw new Error('Local benchmark driver returned an incomplete scenario manifest')
  }
  if (!isRecord(evidence.scenarios)) {
    throw new Error('Local benchmark driver returned invalid scenario evidence')
  }
  const resultIds = Object.keys(evidence.scenarios)
  if (
    resultIds.length !== LOCAL_ABUSE_PERFORMANCE_SCENARIOS.length
    || LOCAL_ABUSE_PERFORMANCE_SCENARIOS.some((id) => !resultIds.includes(id))
  ) {
    throw new Error('Local benchmark driver returned an incomplete scenario manifest')
  }
  for (const id of LOCAL_ABUSE_PERFORMANCE_SCENARIOS) {
    const scenario = evidence.scenarios[id]
    if (!isRecord(scenario) || scenario.assertionsPassed !== true) {
      throw new Error(`Local benchmark scenario did not pass: ${id}`)
    }
  }
  inspectEvidence(evidence)
  return evidence
}

function inspectEvidence(value) {
  if (typeof value === 'string') {
    if (unsafeEvidenceValue.test(value)) {
      throw new Error('Local benchmark returned an unsafe evidence value')
    }
    return
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    for (const item of value) inspectEvidence(item)
    return
  }
  if (!isRecord(value)) {
    throw new Error('Local benchmark returned a non-JSON evidence value')
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveEvidenceKeys.has(normalizeEvidenceKey(key))) {
      throw new Error(`Local benchmark returned an unsafe evidence key: ${key}`)
    }
    inspectEvidence(child)
  }
}

function normalizeEvidenceKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
