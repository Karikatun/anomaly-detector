import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { repositoryHash, repositoryRoot } from './repo-env.mjs'
import {
  assertLocalAcceptanceDatabaseUrl,
  buildLocalMvpAcceptanceEvidence,
  createTenderTimeline,
  localDockerEndpointFromContextInspect,
  localMvpAcceptanceProcessEnvironment,
  localMvpAcceptanceProjectName,
  parseBlockerSelection,
  parseFindingSelection,
  parseIncidentOutcome,
  parseLocalMvpAcceptanceArguments,
  parseStepStatus,
} from './local-mvp-acceptance-support.mjs'

const backendRoot = resolve(repositoryRoot, 'backend')
const webappRoot = resolve(repositoryRoot, 'webapp')
const websiteRoot = resolve(repositoryRoot, 'website')
const composeFile = resolve(repositoryRoot, 'docker-compose.yml')
const databaseName = 'anomaly_detector_test'
const commandTimeoutMs = 5 * 60_000
const cleanupTimeoutMs = 30_000
const serviceStartupTimeoutMs = 2 * 60_000
const childTerminationGraceMs = 5_000
const captureLimitBytes = 256 * 1024

let activeCommand
let browser
let cleaningUp = false
let composeArgs
let composeEnvironment
let composeProjectName
let composeStarted = false
let database
let releaseReservedPorts
let requestedExitCode
let resolveInterruption
let serviceFailureLabel
let resolveServiceFailure
let servicesStopping = false
let stopObserver
let temporaryDirectory

const services = []
const interruption = new Promise((resolveInterrupt) => {
  resolveInterruption = resolveInterrupt
})
const serviceFailure = new Promise((resolveFailure) => {
  resolveServiceFailure = resolveFailure
})

function helpText() {
  return `Локальный acceptance harness для Public MVP Journey.

Использование:
  bun run acceptance:mvp --players 2|3|4 [--browser chromium|firefox]
  bun run acceptance:mvp --players 2 --smoke

Полный прогон требует чистое рабочее дерево и интерактивный терминал. --smoke
проверяет изолированный запуск и cleanup без браузеров и не создаёт evidence.`
}

function requestShutdown(exitCode) {
  if (requestedExitCode !== undefined) return
  requestedExitCode = exitCode
  resolveInterruption()
  if (!cleaningUp && activeCommand) void terminateChild(activeCommand).catch(() => {})
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    let settled = false
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('close', onClose)
      resolveExit(exited)
    }
    const onClose = () => finish(true)
    const timeout = setTimeout(() => finish(childHasExited(child)), timeoutMs)
    child.once('close', onClose)
    if (childHasExited(child)) finish(true)
  })
}

function signalChild(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {}
  }
  try {
    child.kill(signal)
  } catch {}
}

async function terminateChild(child) {
  if (!child || childHasExited(child)) return
  signalChild(child, 'SIGTERM')
  if (await waitForChildExit(child, childTerminationGraceMs)) return
  signalChild(child, 'SIGKILL')
  if (await waitForChildExit(child, childTerminationGraceMs)) return
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.stdin?.destroy()
  child.unref()
  throw new Error('Owned local process did not stop')
}

async function executeCommand(command, args, options = {}) {
  const capture = options.capture === true
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    detached: process.platform !== 'win32',
    env: options.env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
  })
  activeCommand = child
  let outputLimitExceeded = false
  let stderr = ''
  let stdout = ''
  if (capture) {
    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    const append = (target, chunk) => {
      const next = target + chunk
      if (Buffer.byteLength(next) > captureLimitBytes) {
        outputLimitExceeded = true
        void terminateChild(child).catch(() => {})
        return target
      }
      return next
    }
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
  }

  let timedOut = false
  let timeout
  const completed = new Promise((resolveCommand, rejectCommand) => {
    child.once('error', rejectCommand)
    child.once('close', (status, signal) => resolveCommand({ signal, status }))
  })
  const timedCompletion = new Promise((resolveCommand) => {
    timeout = setTimeout(() => {
      timedOut = true
      void terminateChild(child).then(
        () => resolveCommand({ signal: null, status: null }),
        () => resolveCommand({ signal: null, status: null }),
      )
    }, options.timeoutMs ?? commandTimeoutMs)
  })

  try {
    const result = await Promise.race([completed, timedCompletion])
    return { ...result, outputLimitExceeded, stderr, stdout, timedOut }
  } finally {
    clearTimeout(timeout)
    if (activeCommand === child) activeCommand = undefined
  }
}

async function runCommand(command, args, options = {}) {
  if (requestedExitCode !== undefined) throw new Error('Local MVP acceptance was interrupted')
  let result
  try {
    result = await executeCommand(command, args, options)
  } catch {
    throw new Error(`${options.label ?? 'Local command'} could not start`)
  }
  if (requestedExitCode !== undefined) throw new Error('Local MVP acceptance was interrupted')
  if (result.timedOut) {
    throw new Error(`${options.label ?? 'Local command'} timed out`)
  }
  if (result.outputLimitExceeded) {
    throw new Error(`${options.label ?? 'Local command'} returned too much output`)
  }
  if (result.status !== 0) {
    throw new Error(`${options.label ?? 'Local command'} failed with exit code ${result.status ?? 'unknown'}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

function spawnService(label, args, cwd, env) {
  const child = spawn('bun', args, {
    cwd,
    detached: process.platform !== 'win32',
    env,
    stdio: 'ignore',
  })
  services.push({ child, label })
  const reportFailure = () => {
    if (servicesStopping || serviceFailureLabel) return
    serviceFailureLabel = label
    resolveServiceFailure(label)
  }
  child.once('error', reportFailure)
  child.once('close', reportFailure)
  return child
}

async function waitForService({ child, expectedText, label, url }) {
  const deadline = Date.now() + serviceStartupTimeoutMs
  while (Date.now() < deadline) {
    if (requestedExitCode !== undefined) throw new Error('Local MVP acceptance was interrupted')
    if (childHasExited(child)) throw new Error(`${label} stopped during startup`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) })
      const body = await response.text()
      if (response.ok && (!expectedText || body.includes(expectedText))) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`${label} did not become ready on its reserved loopback port`)
}

async function reserveLoopbackPorts(count) {
  const reservations = []
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer()
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen)
        server.listen({ exclusive: true, host: '127.0.0.1', port: 0 }, resolveListen)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Could not reserve a loopback port')
      reservations.push({ port: address.port, server })
    }
  } catch (error) {
    await Promise.allSettled(reservations.map(({ server }) => closeServer(server)))
    throw error
  }

  let released = false
  return {
    ports: reservations.map(({ port }) => port),
    release: async () => {
      if (released) return
      released = true
      await Promise.all(reservations.map(({ server }) => closeServer(server)))
    },
  }
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (requestedExitCode !== undefined) throw new Error('Local MVP acceptance was interrupted')
    const result = await executeCommand('docker', [
      ...composeArgs,
      'exec',
      '-T',
      'postgres_test',
      'pg_isready',
      '-U',
      'superuser',
      '-d',
      databaseName,
    ], { env: composeEnvironment, timeoutMs: 5_000 })
    if (result.status === 0) return
    if (result.timedOut) throw new Error('Isolated PostgreSQL readiness probe timed out')
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error('Isolated PostgreSQL did not become ready')
}

async function assertCleanRevision(environment) {
  const revision = await runCommand('git', ['rev-parse', 'HEAD'], {
    capture: true,
    env: environment,
    label: 'Git revision lookup',
    timeoutMs: 15_000,
  })
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Local MVP acceptance requires a full Git revision')
  }
  const status = await runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    capture: true,
    env: environment,
    label: 'Git worktree check',
    timeoutMs: 15_000,
  })
  if (status) throw new Error('Full local MVP acceptance requires a clean Git worktree')
  return revision
}

async function currentRevision(environment) {
  const revision = await runCommand('git', ['rev-parse', 'HEAD'], {
    capture: true,
    env: environment,
    label: 'Git revision lookup',
    timeoutMs: 15_000,
  })
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Local MVP acceptance requires a full Git revision')
  }
  return revision
}

async function assertUnchangedRevision(expectedRevision) {
  const environment = localMvpAcceptanceProcessEnvironment(process.env, { DO_NOT_TRACK: '1' })
  const finalRevision = await assertCleanRevision(environment)
  if (finalRevision !== expectedRevision) {
    throw new Error('Git revision changed during local MVP acceptance')
  }
}

async function startIsolatedStack(options) {
  const isolatedBaseEnvironment = localMvpAcceptanceProcessEnvironment(process.env, {
    DO_NOT_TRACK: '1',
  })
  const revision = options.smoke
    ? await currentRevision(isolatedBaseEnvironment)
    : await assertCleanRevision(isolatedBaseEnvironment)

  let context
  try {
    context = await executeCommand('docker', ['context', 'inspect'], {
      capture: true,
      env: isolatedBaseEnvironment,
      timeoutMs: 15_000,
    })
  } catch {
    throw new Error('Could not inspect the Docker context')
  }
  if (context.status !== 0 || context.timedOut || context.outputLimitExceeded) {
    throw new Error('Could not inspect the Docker context')
  }
  const dockerEndpoint = localDockerEndpointFromContextInspect(context.stdout)

  temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'anomaly-mvp-acceptance-'))
  const emptyEnvironmentFile = resolve(temporaryDirectory, 'empty.env')
  await writeFile(emptyEnvironmentFile, '', { flag: 'wx', mode: 0o600 })

  const invocationId = randomUUID().replaceAll('-', '').slice(0, 12)
  const projectName = localMvpAcceptanceProjectName(repositoryHash, process.pid, invocationId)
  composeProjectName = projectName
  composeArgs = [
    'compose',
    '--env-file',
    emptyEnvironmentFile,
    '--file',
    composeFile,
    '--project-name',
    projectName,
  ]
  composeEnvironment = localMvpAcceptanceProcessEnvironment(isolatedBaseEnvironment, {
    COMPOSE_PROJECT_NAME: projectName,
    DOCKER_HOST: dockerEndpoint,
    DOTENV_CONFIG_PATH: emptyEnvironmentFile,
    POSTGRES_TEST_PORT: '0',
  })

  process.stdout.write(`Запуск изолированного local-only стенда для ${options.players} игроков…\n`)
  composeStarted = true
  await runCommand('docker', [...composeArgs, 'up', '--pull', 'never', '-d', 'postgres_test'], {
    env: composeEnvironment,
    label: 'Isolated PostgreSQL startup',
  })
  await waitForPostgres()

  const portOutput = await runCommand(
    'docker',
    [...composeArgs, 'port', 'postgres_test', '5432'],
    { capture: true, env: composeEnvironment, label: 'Isolated PostgreSQL port lookup' },
  )
  const databasePort = portOutput.match(/^(?:127\.0\.0\.1|\[::1\]|localhost):(\d+)$/)?.[1]
  if (!databasePort) throw new Error('Could not resolve the isolated loopback PostgreSQL port')
  const databaseUrl = `postgresql://superuser:superpassword@127.0.0.1:${databasePort}/${databaseName}?schema=public`
  assertLocalAcceptanceDatabaseUrl(databaseUrl)

  const databaseEnvironment = localMvpAcceptanceProcessEnvironment(composeEnvironment, {
    CHECKPOINT_DISABLE: '1',
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: emptyEnvironmentFile,
    NODE_ENV: 'test',
    TEST_DATABASE_URL: databaseUrl,
  })
  await runCommand('bun', [`--env-file=${emptyEnvironmentFile}`, 'run', 'prisma:generate'], {
    cwd: backendRoot,
    env: databaseEnvironment,
    label: 'Prisma client generation',
  })
  await runCommand('bun', [`--env-file=${emptyEnvironmentFile}`, 'run', 'prisma:deploy'], {
    cwd: backendRoot,
    env: databaseEnvironment,
    label: 'Prisma migration deploy',
  })

  const reservation = await reserveLoopbackPorts(4)
  releaseReservedPorts = reservation.release
  const [apiPort, workerHealthPort, webappPort, websitePort] = reservation.ports
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const webappOrigin = `http://127.0.0.1:${webappPort}`
  const websiteOrigin = `http://127.0.0.1:${websitePort}`
  const backendEnvironment = localMvpAcceptanceProcessEnvironment(databaseEnvironment, {
    ADMIN_USER_IDS: '',
    ANALYTICS_CAMPAIGN_ALLOWLIST: '',
    ANALYTICS_ENABLED: 'false',
    ANALYTICS_ORIGINS: '',
    API_HOST: '127.0.0.1',
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: webappOrigin,
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: emptyEnvironmentFile,
    JWT_SECRET: randomBytes(32).toString('hex'),
    MAIL_SMTP_ENABLED: 'false',
    NODE_ENV: 'test',
    OAUTH_CALLBACK_BASE_URL: '',
    PORT: String(apiPort),
    SHUTDOWN_GRACE_SECONDS: '2',
    TRUST_PROXY: 'false',
    WEBAPP_ORIGIN: webappOrigin,
    WORKER_HEALTH_HOST: '127.0.0.1',
    WORKER_HEALTH_PORT: String(workerHealthPort),
    YANDEX_OAUTH_CLIENT_ID: '',
    YANDEX_OAUTH_CLIENT_SECRET: '',
    YANDEX_STORAGE_ACCESS_KEY_ID: '',
    YANDEX_STORAGE_BUCKET: '',
    YANDEX_STORAGE_CDN_BASE_URL: '',
    YANDEX_STORAGE_ENDPOINT: '',
    YANDEX_STORAGE_REGION: '',
    YANDEX_STORAGE_SECRET_ACCESS_KEY: '',
  })
  const webappEnvironment = localMvpAcceptanceProcessEnvironment(isolatedBaseEnvironment, {
    LOCAL_MVP_ENV_DIR: temporaryDirectory,
    VITE_AGENTATION_ENABLED: 'false',
    VITE_ANALYTICS_ENABLED: 'false',
    VITE_API_URL: apiOrigin,
    VITE_BUILD_SHA: revision,
    VITE_OAUTH_API_URL: '',
    VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE: '',
    VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS: '',
    VITE_PUBLIC_LEGAL_OPERATOR_NAME: '',
    VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT: '',
    WEBAPP_RELEASE_BUILD: 'false',
  })
  const websiteEnvironment = localMvpAcceptanceProcessEnvironment(isolatedBaseEnvironment, {
    ASTRO_DEV_BACKGROUND: '0',
    ASTRO_TELEMETRY_DISABLED: '1',
    LOCAL_MVP_ENV_DIR: temporaryDirectory,
    PUBLIC_ANALYTICS_API_URL: '',
    PUBLIC_ANALYTICS_CAMPAIGN_ALLOWLIST: '',
    PUBLIC_WEBAPP_URL: webappOrigin,
    PUBLIC_WEBSITE_URL: websiteOrigin,
    WEBSITE_RELEASE_BUILD: 'false',
  })

  await releaseReservedPorts()
  releaseReservedPorts = undefined
  const bunEnvironmentFile = `--env-file=${emptyEnvironmentFile}`
  const api = spawnService('Backend API', [bunEnvironmentFile, 'run', 'start:raw'], backendRoot, backendEnvironment)
  const worker = spawnService('Backend worker', [bunEnvironmentFile, 'run', 'start:worker'], backendRoot, backendEnvironment)
  const webapp = spawnService(
    'Player webapp',
    [bunEnvironmentFile, 'run', 'dev', '--host', '127.0.0.1', '--port', String(webappPort), '--strictPort'],
    webappRoot,
    webappEnvironment,
  )
  const website = spawnService(
    'Public website',
    [bunEnvironmentFile, 'run', 'dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(websitePort)],
    websiteRoot,
    websiteEnvironment,
  )

  await Promise.all([
    waitForService({ child: api, expectedText: '"status":"ok"', label: 'Backend API', url: `${apiOrigin}/health/ready` }),
    waitForService({ child: worker, expectedText: '"status":"ok"', label: 'Backend worker', url: `http://127.0.0.1:${workerHealthPort}/health/ready` }),
    waitForService({ child: webapp, expectedText: '<div id="root"></div>', label: 'Player webapp', url: webappOrigin }),
    waitForService({ child: website, expectedText: 'Anomaly Detector', label: 'Public website', url: websiteOrigin }),
  ])

  return {
    apiOrigin,
    browserEnvironment: isolatedBaseEnvironment,
    databaseUrl,
    revision,
    webappOrigin,
    websiteOrigin,
  }
}

function createAggregateObserver(expectedPlayerCount) {
  const timeline = createTenderTimeline(expectedPlayerCount)
  let currentSample
  let failure
  let timer

  const sample = async () => {
    const rows = await database.$queryRaw`
      SELECT
        created_at AS "createdAt",
        COALESCE(state ? 'completionReason', false) AS "endedEarly",
        phase,
        jsonb_array_length(state -> 'players') AS "playerCount",
        (state ->> 'round')::int AS round,
        updated_at AS "updatedAt"
      FROM tenders
      ORDER BY created_at
    `
    timeline.observe(rows.map((row) => ({
      createdAt: row.createdAt,
      endedEarly: row.endedEarly,
      phase: row.phase,
      playerCount: row.playerCount,
      round: row.round,
      updatedAt: row.updatedAt,
    })))
  }
  const tick = () => {
    if (currentSample || failure) return
    currentSample = sample()
      .catch(() => { failure = new Error('Safe aggregate observation failed') })
      .finally(() => { currentSample = undefined })
  }

  return {
    start: async () => {
      await sample()
      timer = setInterval(tick, 250)
    },
    stop: async () => {
      clearInterval(timer)
      if (currentSample) await currentSample
      if (!failure) {
        try {
          await sample()
        } catch {
          failure = new Error('Safe aggregate observation failed')
        }
      }
      if (failure) throw failure
      return timeline.summary()
    },
  }
}

async function aggregateOutcomeCounts() {
  const rows = await database.$queryRaw`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS "disposableAccountCount",
      (SELECT COUNT(*)::int FROM feedback_reports) AS "feedbackReportCount",
      (SELECT COUNT(*)::int FROM tender_rooms) AS "roomCount",
      (SELECT COUNT(*)::int FROM users WHERE tutorial_completed_at IS NOT NULL) AS "tutorialCompletionCount"
  `
  if (rows.length !== 1) throw new Error('Safe aggregate count query returned an invalid shape')
  return rows[0]
}

async function openParticipantWindows(options, origins) {
  let playwright
  try {
    playwright = await import('@playwright/test')
    browser = await playwright[options.browser].launch({
      env: origins.browserEnvironment,
      headless: false,
    })
  } catch {
    throw new Error('Could not open the selected local browser; run bun run --cwd webapp e2e:install')
  }
  const browserVersion = browser.version()
  const contexts = []
  try {
    for (let index = 0; index < options.players; index += 1) {
      const context = await browser.newContext({
        acceptDownloads: false,
        viewport: { height: 900, width: 1440 },
      })
      contexts.push(context)
      const page = await context.newPage()
      await page.goto(index === 0 ? origins.websiteOrigin : origins.webappOrigin, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      })
    }
  } catch {
    throw new Error('Could not prepare isolated participant windows')
  }
  return browserVersion
}

async function waitForFacilitator() {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  const answer = readline.question(
    '\nПроведите сценарий в открытых окнах. Нажмите Enter после завершения или остановки прогона.\n',
  ).then(() => 'entered').catch(() => 'closed')
  const outcome = await Promise.race([
    answer,
    interruption.then(() => 'interrupted'),
    serviceFailure.then(() => 'service_failed'),
  ])
  readline.close()
  if (outcome === 'interrupted') throw new Error('Local MVP acceptance was interrupted')
  if (outcome === 'service_failed') {
    throw new Error(`${serviceFailureLabel ?? 'Local service'} stopped during the human run`)
  }
  if (outcome !== 'entered') throw new Error('Facilitator input closed before completion')
}

async function runHumanAcceptance(options, stack) {
  const { createPrisma } = await import('../backend/src/db.ts')
  database = createPrisma(stack.databaseUrl)
  const observer = createAggregateObserver(options.players)
  stopObserver = observer.stop
  await observer.start()

  const browserVersion = await openParticipantWindows(options, stack)
  const startedAt = new Date()
  process.stdout.write(`\nОкно 1: ${stack.websiteOrigin}\n`)
  process.stdout.write(`Окна 2–${options.players}: ${stack.webappOrigin}\n`)
  process.stdout.write('Все окна изолированы. Не вводите реальные адреса электронной почты и не копируйте коды/идентификаторы в терминал.\n')
  await waitForFacilitator()
  const completedAt = new Date()
  const tenderSummary = await observer.stop()
  stopObserver = undefined
  const counts = await aggregateOutcomeCounts()
  return {
    browserVersion,
    completedAt,
    observation: { ...counts, ...tenderSummary },
    startedAt,
  }
}

async function askValidated(readline, prompt, parse) {
  while (true) {
    if (requestedExitCode !== undefined) throw new Error('Local MVP acceptance was interrupted')
    let answer
    try {
      answer = await Promise.race([
        readline.question(prompt),
        interruption.then(() => undefined),
      ])
    } catch {
      throw new Error('Questionnaire input closed before completion')
    }
    if (answer === undefined) throw new Error('Local MVP acceptance was interrupted')
    try {
      return parse(answer)
    } catch {
      process.stdout.write('Недопустимое значение; используйте только указанные коды.\n')
    }
  }
}

async function collectQuestionnaire() {
  process.stdout.write('\nСтенд и disposable data удалены. Заполните только фиксированную сводку.\n')
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const journey = {}
    const prompts = [
      ['landingCta', 'Landing и CTA к регистрации — п/ф/н: '],
      ['passwordRegistration', 'Регистрация с паролем — п/ф/н: '],
      ['tutorialFirstPlayerValue', 'Tutorial и First Player Value — п/ф/н: '],
      ['recoveryEmailOffer', 'Предложение Recovery Email без отправки — п/ф/н: '],
      ['feedbackReceipt', 'Feedback Report и receipt — п/ф/н: '],
    ]
    for (const [key, prompt] of prompts) {
      journey[key] = await askValidated(readline, prompt, parseStepStatus)
    }
    process.stdout.write('Finding: category:owner через пробел; пусто = нет.\n')
    process.stdout.write('Категории: defect accessibility_usability rule_misunderstanding support_request abuse operational_incident balance_observation.\n')
    process.stdout.write('Owners: engineering product operations support security legal.\n')
    const findingEntries = await askValidated(readline, 'Findings: ', parseFindingSelection)
    process.stdout.write('Blockers: availability device environment legal mail operations product security support; пусто = нет.\n')
    const blockerCategories = await askValidated(readline, 'Blockers: ', parseBlockerSelection)
    const incidentOutcome = await askValidated(
      readline,
      'Incident outcome — none/contained/unresolved: ',
      parseIncidentOutcome,
    )
    return { blockerCategories, findingEntries, incidentOutcome, journey }
  } finally {
    readline.close()
  }
}

async function cleanupOwnedResources() {
  if (cleaningUp) return { composeRemoved: false, succeeded: false }
  cleaningUp = true
  servicesStopping = true
  let succeeded = true
  let composeRemoved = false
  process.stdout.write('Удаление invocation-scoped local-only стенда…\n')

  if (stopObserver) {
    try {
      await stopObserver()
    } catch {
      succeeded = false
    }
    stopObserver = undefined
  }
  if (browser) {
    try {
      await browser.close()
    } catch {
      succeeded = false
    }
    browser = undefined
  }
  if (database) {
    try {
      await database.$disconnect()
    } catch {
      succeeded = false
    }
    database = undefined
  }
  if (releaseReservedPorts) {
    try {
      await releaseReservedPorts()
    } catch {
      succeeded = false
    }
    releaseReservedPorts = undefined
  }
  for (const { child } of services.reverse()) {
    try {
      await terminateChild(child)
    } catch {
      succeeded = false
    }
  }
  services.length = 0

  if (composeStarted && composeArgs && composeEnvironment) {
    try {
      const result = await executeCommand(
        'docker',
        [...composeArgs, 'down', '-v', '--remove-orphans'],
        { env: composeEnvironment, timeoutMs: cleanupTimeoutMs },
      )
      composeRemoved = !result.timedOut && result.status === 0
      if (!composeRemoved) succeeded = false
    } catch {
      succeeded = false
    }
  }
  if (temporaryDirectory) {
    try {
      await rm(temporaryDirectory, { force: true, recursive: true })
    } catch {
      succeeded = false
    }
    temporaryDirectory = undefined
  }
  if (composeRemoved) process.stdout.write('Cleanup подтверждён: project и volume удалены.\n')
  return { composeRemoved, succeeded }
}

async function writeEvidence(options, revision, run, questionnaire) {
  if (requestedExitCode !== undefined) throw new Error('Local MVP acceptance was interrupted')
  await assertUnchangedRevision(revision)
  const evidence = buildLocalMvpAcceptanceEvidence({
    ...questionnaire,
    browser: options.browser,
    browserVersion: run.browserVersion,
    cleanupConfirmed: true,
    completedAt: run.completedAt,
    observation: run.observation,
    playerCount: options.players,
    revision,
    startedAt: run.startedAt,
  })
  const evidenceDirectory = resolve(repositoryRoot, '.scratch', 'local-mvp-acceptance')
  await mkdir(evidenceDirectory, { recursive: true })
  const timestamp = run.completedAt.toISOString().replaceAll(':', '-').replace('.', '-')
  const evidencePath = resolve(
    evidenceDirectory,
    `${timestamp}-${options.players}p-${options.browser}.json`,
  )
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  return { evidence, evidencePath }
}

async function runAcceptance(options) {
  if (!options.smoke && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('Full local MVP acceptance requires an interactive terminal')
  }

  let operation
  let operationError
  let stack
  try {
    stack = await startIsolatedStack(options)
    if (options.smoke) {
      operation = { kind: 'smoke' }
    } else {
      operation = { kind: 'human', run: await runHumanAcceptance(options, stack) }
    }
  } catch (error) {
    operationError = error
  }

  const cleanup = await cleanupOwnedResources()
  if (requestedExitCode !== undefined) {
    if (!cleanup.succeeded) process.stderr.write(cleanupFailureMessage())
    process.exitCode = requestedExitCode
    return
  }
  if (operationError) {
    process.stderr.write(`${operationError instanceof Error ? operationError.message : 'Local MVP acceptance failed'}\n`)
    if (!cleanup.succeeded) process.stderr.write(cleanupFailureMessage())
    process.exitCode = 1
    return
  }
  if (!cleanup.succeeded || !cleanup.composeRemoved) {
    process.stderr.write(cleanupFailureMessage())
    process.exitCode = 1
    return
  }
  if (operation.kind === 'smoke') {
    process.stdout.write('Smoke PASS: local-only стек был готов и полностью удалён; acceptance evidence не создавался.\n')
    return
  }

  try {
    await assertUnchangedRevision(stack.revision)
    const questionnaire = await collectQuestionnaire()
    const result = await writeEvidence(options, stack.revision, operation.run, questionnaire)
    process.stdout.write(`Evidence: ${result.evidencePath}\n`)
    process.stdout.write(`Итог локального прогона: ${result.evidence.status.toUpperCase()} (production acceptance не доказан).\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Could not create sanitized evidence'}\n`)
    process.exitCode = requestedExitCode ?? 1
  }
}

function cleanupFailureMessage() {
  const project = composeProjectName ? ` Exact Compose project: ${composeProjectName}.` : ''
  return `Cleanup invocation-scoped стенда не подтверждён; evidence не создан.${project}\n`
}

if (import.meta.main) {
  process.on('SIGINT', () => requestShutdown(130))
  process.on('SIGTERM', () => requestShutdown(143))

  let options
  try {
    options = parseLocalMvpAcceptanceArguments(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid arguments'}\n`)
    process.exitCode = 1
  }
  if (options?.help) {
    process.stdout.write(`${helpText()}\n`)
  } else if (options) {
    try {
      await runAcceptance(options)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Local MVP acceptance failed'}\n`)
      process.exitCode = 1
    }
  }
}
