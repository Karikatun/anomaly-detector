const supportedPlayerCounts = new Set([2, 3, 4])
const supportedBrowsers = new Set(['chromium', 'firefox'])
const stepStatuses = new Set(['pass', 'fail', 'not_run'])
const findingCategories = new Set([
  'abuse',
  'accessibility_usability',
  'balance_observation',
  'defect',
  'operational_incident',
  'rule_misunderstanding',
  'support_request',
])
const followUpOwners = new Set([
  'engineering',
  'legal',
  'operations',
  'product',
  'security',
  'support',
])
const blockerCategories = new Set([
  'availability',
  'device',
  'environment',
  'legal',
  'mail',
  'operations',
  'product',
  'security',
  'support',
])
const incidentOutcomes = new Set(['contained', 'none', 'unresolved'])
const tenderPhases = new Set([
  'access-slot-selection',
  'power-allocation',
  'reconnaissance',
  'laboratory',
  'model-analysis',
  'contracts',
  'final-scientific-model',
  'complete',
])
const journeyKeys = Object.freeze([
  'landingCta',
  'passwordRegistration',
  'tutorialFirstPlayerValue',
  'recoveryEmailOffer',
  'feedbackReceipt',
])
const inheritedEnvironmentKeys = new Set([
  'COLORTERM',
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NO_COLOR',
  'PATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'SHELL',
  'TERM',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  '__CF_USER_TEXT_ENCODING',
])
const isolatedEnvironmentKeys = new Set([
  'ALL_PROXY',
  'BUN_OPTIONS',
  'CI',
  'DATABASE_URL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NO_PROXY',
  'PGDATABASE',
  'PGHOST',
  'PGPASSWORD',
  'PGPORT',
  'PGSERVICE',
  'PGSSLMODE',
  'PGUSER',
  'PORT',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEST_DATABASE_URL',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
])
const isolatedEnvironmentPrefixes = [
  'ACCESS_TOKEN_',
  'ADMIN_',
  'ANALYTICS_',
  'ANTI_ABUSE_',
  'ASTRO_',
  'AWS_',
  'BUN_',
  'AUTH_',
  'COMPOSE_',
  'COOKIE_',
  'DOCKER_',
  'DOTENV_CONFIG_',
  'E2E_',
  'FEEDBACK_',
  'GIT_',
  'JWT_',
  'MAIL_',
  'NPM_CONFIG_',
  'OAUTH_',
  'OPERATIONAL_METRICS_',
  'POSTGRES_',
  'PRISMA_',
  'PUBLIC_',
  'REFRESH_',
  'SESSION_',
  'SHUTDOWN_',
  'SPLIT_DOMAIN_',
  'S3_',
  'TRUST_',
  'UX_AUDIT_',
  'VITE_',
  'VK_',
  'WEBAPP_',
  'WEBSITE_',
  'WORKER_',
  'YANDEX_',
  'npm_config_',
]
const sensitiveEvidenceKeys = new Set([
  'accessToken',
  'accountEmail',
  'authorization',
  'clientAddress',
  'code',
  'cookie',
  'credential',
  'databaseUrl',
  'email',
  'ipAddress',
  'login',
  'message',
  'objectId',
  'password',
  'privateState',
  'publicNumber',
  'recipient',
  'recoveryCode',
  'recoveryEmail',
  'refreshToken',
  'roomCode',
  'roomId',
  'secret',
  'sessionId',
  'sourceUrl',
  'tenderId',
  'ticket',
  'token',
  'url',
  'userId',
].map(normalizeEvidenceKey))
const unsafeEvidenceValue = /(?:postgres(?:ql)?:\/\/|https?:\/\/|wss?:\/\/|\$argon2|Bearer\s|[^\s@]+@[^\s@]+|[?&#](?:code|token|ticket)=|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b)/i

export function parseLocalMvpAcceptanceArguments(argv) {
  let browser = 'chromium'
  let browserWasSet = false
  let help = false
  let players
  let smoke = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--smoke') {
      smoke = true
      continue
    }
    if (argument === '--players' || argument.startsWith('--players=')) {
      if (players !== undefined) throw new Error('--players must be provided once')
      const value = argument === '--players' ? argv[++index] : argument.slice('--players='.length)
      players = parsePlayerCount(value)
      continue
    }
    if (argument === '--browser' || argument.startsWith('--browser=')) {
      if (browserWasSet) throw new Error('--browser must be provided once')
      const value = argument === '--browser' ? argv[++index] : argument.slice('--browser='.length)
      if (!supportedBrowsers.has(value)) {
        throw new Error('--browser must be chromium or firefox')
      }
      browser = value
      browserWasSet = true
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!help && players === undefined) throw new Error('--players is required')
  return { browser, help, players, smoke }
}

function parsePlayerCount(value) {
  const players = Number(value)
  if (!supportedPlayerCounts.has(players) || String(players) !== value) {
    throw new Error('--players must be 2, 3, or 4')
  }
  return players
}

export function localMvpAcceptanceProcessEnvironment(baseEnvironment, overrides = {}) {
  const environment = {}
  for (const [name, value] of Object.entries(baseEnvironment)) {
    if (!inheritedEnvironmentKeys.has(name) || typeof value !== 'string') continue
    if (
      isolatedEnvironmentKeys.has(name)
      || isolatedEnvironmentPrefixes.some((prefix) => name.startsWith(prefix))
    ) {
      continue
    }
    environment[name] = value
  }
  return { ...environment, ...overrides }
}

export function localDockerEndpointFromContextInspect(output) {
  let contexts
  try {
    contexts = JSON.parse(output)
  } catch {
    throw new Error('Local MVP acceptance requires valid Docker context JSON')
  }

  const endpoint = contexts?.[0]?.Endpoints?.docker?.Host
  if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) {
    throw new Error('Local MVP acceptance requires a local Unix-socket Docker context')
  }
  return endpoint
}

export function assertLocalAcceptanceDatabaseUrl(databaseUrl) {
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
    throw new Error('Local MVP acceptance requires a loopback *_test PostgreSQL target')
  }
}

export function localMvpAcceptanceProjectName(repositoryHash, processId, invocationId) {
  if (!/^[a-f0-9]{8,16}$/.test(repositoryHash)) {
    throw new Error('Local MVP acceptance repository hash must be hexadecimal')
  }
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error('Local MVP acceptance process id must be a positive integer')
  }
  if (!/^[a-z0-9]{6,16}$/.test(invocationId)) {
    throw new Error('Local MVP acceptance invocation id must be a safe lowercase segment')
  }
  return `anomaly-mvp-${repositoryHash}-${processId}-${invocationId}`
}

export function createTenderTimeline(expectedPlayerCount) {
  if (!supportedPlayerCounts.has(expectedPlayerCount)) {
    throw new Error('Tender timeline requires 2, 3, or 4 players')
  }

  let ambiguous = false
  let firstCreatedAt
  let latest
  let playerCountMismatch = false
  let tenderCount = 0
  let currentPhase
  const phaseDurations = []

  return {
    observe(rows) {
      if (!Array.isArray(rows)) throw new Error('Tender observation must be an array')
      tenderCount = Math.max(tenderCount, rows.length)
      if (rows.length > 1) {
        ambiguous = true
        return
      }
      if (rows.length === 0 || ambiguous) return

      const snapshot = normalizeTenderSnapshot(rows[0])
      if (snapshot.playerCount !== expectedPlayerCount) playerCountMismatch = true
      firstCreatedAt ??= snapshot.createdAt

      if (!currentPhase) {
        currentPhase = {
          phase: snapshot.phase,
          round: snapshot.round,
          startedAt: snapshot.createdAt,
        }
      } else if (
        currentPhase.phase !== snapshot.phase
        || currentPhase.round !== snapshot.round
      ) {
        if (currentPhase.phase !== 'complete') {
          phaseDurations.push({
            durationMs: Math.max(0, snapshot.updatedAt.getTime() - currentPhase.startedAt.getTime()),
            phase: currentPhase.phase,
            round: currentPhase.round,
          })
        }
        currentPhase = {
          phase: snapshot.phase,
          round: snapshot.round,
          startedAt: snapshot.updatedAt,
        }
      }
      latest = snapshot
    },

    summary() {
      if (ambiguous) return emptyTenderSummary('ambiguous', tenderCount)
      if (!latest) return emptyTenderSummary('not_completed', 0)

      const completed = latest.phase === 'complete'
      const matchOutcome = playerCountMismatch
        ? 'player_count_mismatch'
        : completed && latest.endedEarly
          ? 'completed_early'
          : completed
            ? 'completed_normally'
            : 'not_completed'
      const totalDurationMs = completed && firstCreatedAt
        ? Math.max(0, latest.updatedAt.getTime() - firstCreatedAt.getTime())
        : undefined
      const phaseTimingCoverage = completed
        ? isCompleteObservedPhaseSequence(phaseDurations)
          ? 'complete'
          : phaseDurations.length > 0
            ? 'partial'
            : 'none'
        : phaseDurations.length > 0
          ? 'partial'
          : 'none'

      return {
        matchOutcome,
        observedPlayerCount: latest.playerCount,
        phaseDurations: phaseDurations.map(({ durationMs, phase, round }) => ({
          durationMs,
          phase,
          round,
        })),
        phaseTimingCoverage,
        tenderCount,
        ...(totalDurationMs === undefined ? {} : { totalDurationMs }),
      }
    },
  }
}

function normalizeTenderSnapshot(value) {
  if (!isRecord(value)
    || !tenderPhases.has(value.phase)
    || !Number.isInteger(value.round)
    || value.round < 1
    || value.round > 5
    || !supportedPlayerCounts.has(value.playerCount)
    || typeof value.endedEarly !== 'boolean') {
    throw new Error('Tender observation contains an invalid bounded state')
  }
  const createdAt = toValidDate(value.createdAt, 'Tender creation time')
  const updatedAt = toValidDate(value.updatedAt, 'Tender update time')
  if (updatedAt < createdAt) throw new Error('Tender observation time moved backwards')
  return { ...value, createdAt, updatedAt }
}

function emptyTenderSummary(matchOutcome, tenderCount) {
  return {
    matchOutcome,
    phaseDurations: [],
    phaseTimingCoverage: 'none',
    tenderCount,
  }
}

function expectedPhaseSequence() {
  const perRound = [
    'access-slot-selection',
    'power-allocation',
    'reconnaissance',
    'laboratory',
    'model-analysis',
    'contracts',
  ]
  return [
    ...Array.from({ length: 5 }, (_, index) => perRound.map((phase) => ({
      phase,
      round: index + 1,
    }))).flat(),
    { phase: 'final-scientific-model', round: 5 },
  ]
}

function isCompleteObservedPhaseSequence(durations) {
  const expected = expectedPhaseSequence()
  if (durations.length < 2) return false
  if (durations[0].phase !== expected[0].phase || durations[0].round !== expected[0].round) {
    return false
  }
  const expectedFinal = expected.at(-1)
  const observedFinal = durations.at(-1)
  if (observedFinal.phase !== expectedFinal.phase || observedFinal.round !== expectedFinal.round) {
    return false
  }
  const observedKeys = new Set(durations.map(({ phase, round }) => `${round}:${phase}`))
  for (let round = 1; round <= 5; round += 1) {
    for (const phase of ['access-slot-selection', 'power-allocation']) {
      if (!observedKeys.has(`${round}:${phase}`)) return false
    }
  }

  let expectedIndex = -1
  for (const duration of durations) {
    const nextIndex = expected.findIndex((candidate, index) => (
      index > expectedIndex
      && candidate.phase === duration.phase
      && candidate.round === duration.round
    ))
    if (nextIndex === -1) return false
    expectedIndex = nextIndex
  }
  return true
}

export function parseStepStatus(value) {
  const normalized = value.trim().toLowerCase()
  const aliases = {
    f: 'fail',
    fail: 'fail',
    n: 'not_run',
    not_run: 'not_run',
    p: 'pass',
    pass: 'pass',
    н: 'not_run',
    п: 'pass',
    ф: 'fail',
  }
  const status = aliases[normalized]
  if (!stepStatuses.has(status)) {
    throw new Error('Step status must be pass, fail, or not_run')
  }
  return status
}

export function parseFindingSelection(value) {
  const normalized = value.trim()
  if (!normalized) return []
  const counts = new Map()
  for (const token of normalized.split(/\s+/)) {
    const [category, owner, extra] = token.split(':')
    if (extra !== undefined || !findingCategories.has(category) || !followUpOwners.has(owner)) {
      throw new Error('Each finding must use a supported finding category:owner pair')
    }
    const key = `${category}:${owner}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .map(([key, count]) => {
      const [category, owner] = key.split(':')
      return { category, count, owner }
    })
    .sort((left, right) => left.category.localeCompare(right.category)
      || left.owner.localeCompare(right.owner))
}

export function parseBlockerSelection(value) {
  const normalized = value.trim()
  if (!normalized) return []
  const result = new Set()
  for (const token of normalized.split(/[\s,]+/).filter(Boolean)) {
    if (!blockerCategories.has(token)) {
      throw new Error('Each blocker must use a supported blocker category')
    }
    result.add(token)
  }
  return [...result].sort()
}

export function parseIncidentOutcome(value) {
  const normalized = value.trim().toLowerCase()
  if (!incidentOutcomes.has(normalized)) {
    throw new Error('Incident outcome must be none, contained, or unresolved')
  }
  return normalized
}

export function buildLocalMvpAcceptanceEvidence(input) {
  if (input.cleanupConfirmed !== true) {
    throw new Error('Local MVP acceptance evidence requires confirmed cleanup')
  }
  if (!supportedPlayerCounts.has(input.playerCount)) {
    throw new Error('Local MVP acceptance evidence requires 2, 3, or 4 players')
  }
  if (!supportedBrowsers.has(input.browser)) {
    throw new Error('Local MVP acceptance evidence requires a supported browser')
  }
  if (typeof input.browserVersion !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(input.browserVersion)) {
    throw new Error('Local MVP acceptance evidence requires a bounded browser version')
  }
  if (!/^[a-f0-9]{40}$/.test(input.revision)) {
    throw new Error('Local MVP acceptance evidence requires a full Git revision')
  }
  const startedAt = toValidDate(input.startedAt, 'Acceptance start time')
  const completedAt = toValidDate(input.completedAt, 'Acceptance completion time')
  if (completedAt < startedAt) throw new Error('Acceptance completion precedes its start')
  const journey = normalizeJourney(input.journey)
  const findings = normalizeFindings(input.findingEntries)
  const blockers = normalizeBlockers(input.blockerCategories)
  const incidentOutcome = parseIncidentOutcome(input.incidentOutcome)
  const observation = normalizeObservation(input.observation, input.playerCount)
  const status = acceptanceStatus({ blockers, incidentOutcome, journey, observation, playerCount: input.playerCount })

  const evidence = {
    artifactRetention: 'ephemeral_cleanup_confirmed',
    blockerCategories: blockers,
    browserClass: input.browser === 'chromium' ? 'desktop_chromium' : 'desktop_firefox',
    browserVersion: input.browserVersion,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    evidenceVersion: 1,
    externalGates: {
      legalOperationsSignOff: 'not_run',
      liveMailAndRecovery: 'not_run',
      physicalDeviceMatrix: 'not_run',
      productionDeployment: 'not_used',
      supportAndIncidentRouting: 'not_run',
    },
    findings,
    incidentOutcome,
    journey,
    kind: 'local_mvp_human_acceptance',
    observation,
    playerCount: input.playerCount,
    productionAcceptance: 'not_proven',
    revision: input.revision,
    scope: 'local_isolated',
    startedAt: startedAt.toISOString(),
    status,
  }
  assertSafeLocalMvpAcceptanceEvidence(evidence)
  return evidence
}

function normalizeJourney(value) {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== [...journeyKeys].sort().join(',')) {
    throw new Error('Local MVP acceptance journey has an invalid fixed shape')
  }
  return Object.fromEntries(journeyKeys.map((key) => {
    if (!stepStatuses.has(value[key])) {
      throw new Error(`Local MVP acceptance journey has an invalid status for ${key}`)
    }
    return [key, value[key]]
  }))
}

function normalizeFindings(entries) {
  if (!Array.isArray(entries)) throw new Error('Local MVP acceptance findings must be an array')
  return entries.map((entry) => {
    if (!isRecord(entry)
      || !findingCategories.has(entry.category)
      || !followUpOwners.has(entry.owner)
      || !Number.isInteger(entry.count)
      || entry.count < 1
      || entry.count > 100) {
      throw new Error('Local MVP acceptance finding is outside the bounded vocabulary')
    }
    return { category: entry.category, count: entry.count, owner: entry.owner }
  })
}

function normalizeBlockers(entries) {
  if (!Array.isArray(entries)) throw new Error('Local MVP acceptance blockers must be an array')
  const unique = new Set(entries)
  if (unique.size !== entries.length || entries.some((entry) => !blockerCategories.has(entry))) {
    throw new Error('Local MVP acceptance blocker is outside the bounded vocabulary')
  }
  return [...entries].sort()
}

function normalizeObservation(value, expectedPlayerCount) {
  if (!isRecord(value)) throw new Error('Local MVP acceptance observation must be an object')
  const integerKeys = [
    'disposableAccountCount',
    'feedbackReportCount',
    'roomCount',
    'tenderCount',
    'tutorialCompletionCount',
  ]
  for (const key of integerKeys) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 100) {
      throw new Error(`Local MVP acceptance observation has an invalid ${key}`)
    }
  }
  if (![
    'ambiguous',
    'completed_early',
    'completed_normally',
    'not_completed',
    'player_count_mismatch',
  ].includes(value.matchOutcome)) {
    throw new Error('Local MVP acceptance observation has an invalid match outcome')
  }
  if (!['complete', 'none', 'partial'].includes(value.phaseTimingCoverage)) {
    throw new Error('Local MVP acceptance observation has invalid phase timing coverage')
  }
  if (!Array.isArray(value.phaseDurations)) {
    throw new Error('Local MVP acceptance observation phase durations must be an array')
  }
  const phaseDurations = value.phaseDurations.map((duration) => {
    if (!isRecord(duration)
      || !tenderPhases.has(duration.phase)
      || duration.phase === 'complete'
      || !Number.isInteger(duration.round)
      || duration.round < 1
      || duration.round > 5
      || !Number.isInteger(duration.durationMs)
      || duration.durationMs < 0) {
      throw new Error('Local MVP acceptance observation has an invalid phase duration')
    }
    return {
      durationMs: duration.durationMs,
      phase: duration.phase,
      round: duration.round,
    }
  })
  const observedPlayerCount = value.observedPlayerCount
  if (observedPlayerCount !== undefined && !supportedPlayerCounts.has(observedPlayerCount)) {
    throw new Error('Local MVP acceptance observation has an invalid player count')
  }
  const totalDurationMs = value.totalDurationMs
  if (totalDurationMs !== undefined && (!Number.isInteger(totalDurationMs) || totalDurationMs < 0)) {
    throw new Error('Local MVP acceptance observation has an invalid total duration')
  }
  const fourPlayerDurationTarget = expectedPlayerCount !== 4 || totalDurationMs === undefined
    ? 'not_applicable'
    : totalDurationMs < 40 * 60_000
      ? 'shorter_than_40_minutes'
      : totalDurationMs <= 50 * 60_000
        ? 'within_40_to_50_minutes'
        : 'longer_than_50_minutes'

  return {
    disposableAccountCount: value.disposableAccountCount,
    feedbackReportCount: value.feedbackReportCount,
    fourPlayerDurationTarget,
    matchOutcome: value.matchOutcome,
    ...(observedPlayerCount === undefined ? {} : { observedPlayerCount }),
    phaseDurations,
    phaseTimingCoverage: value.phaseTimingCoverage,
    roomCount: value.roomCount,
    tenderCount: value.tenderCount,
    ...(totalDurationMs === undefined ? {} : { totalDurationMs }),
    tutorialCompletionCount: value.tutorialCompletionCount,
  }
}

function acceptanceStatus({ blockers, incidentOutcome, journey, observation, playerCount }) {
  if (blockers.length > 0 || incidentOutcome === 'unresolved') return 'fail'
  if (observation.matchOutcome !== 'completed_normally') return 'fail'
  if (observation.disposableAccountCount !== playerCount
    || observation.feedbackReportCount !== 1
    || observation.roomCount !== 1
    || observation.tenderCount !== 1
    || observation.tutorialCompletionCount !== 1) return 'fail'
  if (Object.values(journey).includes('fail')) return 'fail'
  if (incidentOutcome === 'contained'
    || Object.values(journey).includes('not_run')
    || observation.phaseTimingCoverage !== 'complete') {
    return 'partial'
  }
  return 'pass'
}

export function assertSafeLocalMvpAcceptanceEvidence(evidence) {
  if (!isRecord(evidence)
    || evidence.evidenceVersion !== 1
    || evidence.kind !== 'local_mvp_human_acceptance'
    || evidence.scope !== 'local_isolated'
    || evidence.productionAcceptance !== 'not_proven'
    || !/^[a-f0-9]{40}$/.test(evidence.revision)) {
    throw new Error('Local MVP acceptance returned an invalid evidence envelope')
  }
  inspectEvidence(evidence)
  return evidence
}

function inspectEvidence(value, path = []) {
  if (typeof value === 'string') {
    if (path.length === 1 && path[0] === 'revision') return
    if (unsafeEvidenceValue.test(value)) {
      throw new Error('Local MVP acceptance returned an unsafe evidence value')
    }
    return
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    for (const item of value) inspectEvidence(item, path)
    return
  }
  if (!isRecord(value)) {
    throw new Error('Local MVP acceptance returned a non-JSON evidence value')
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveEvidenceKeys.has(normalizeEvidenceKey(key))) {
      throw new Error(`Local MVP acceptance returned an unsafe evidence key: ${key}`)
    }
    inspectEvidence(child, [...path, key])
  }
}

function normalizeEvidenceKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toValidDate(value, label) {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date`)
  return date
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
