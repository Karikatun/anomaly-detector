import { performance } from 'node:perf_hooks'

import { createApp } from '../src/app'
import { createPrisma, type DbClient } from '../src/db'
import { loadEnv, type AppEnv } from '../src/env'
import { createPrismaActiveSessionGuard } from '../src/modules/auth'
import {
  hashPassword,
  passwordHashNeedsRehash,
  verifyPassword,
} from '../src/modules/auth/infrastructure/passwords'
import { derivePasswordResetToken } from '../src/modules/mail'
import { TransactionalMailDeliveryService } from '../src/modules/mail/application/transactional-mail-delivery-service'
import {
  createPrismaMailOutboxRepository,
  createPrismaTransactionalMailWriter,
} from '../src/modules/mail/infrastructure/prisma-transactional-mail-outbox'
import {
  createPrismaRealtimeTicketStore,
  createPrismaTenderStore,
  createRealtimeHub,
  createRealtimeWebSocketHandlers,
  createTenderModule,
  upgradeRealtimeWebSocket,
  type RealtimeHub,
  type RealtimeSocketData,
} from '../src/modules/tender'
import {
  LOCAL_ABUSE_PERFORMANCE_SCENARIOS,
  assertLocalTestDatabaseUrl,
} from '../../scripts/local-abuse-performance-support.mjs'

const benchmarkPassword = 'local-benchmark-password123'
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
assertLocalTestDatabaseUrl(databaseUrl)
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== databaseUrl) {
  throw new Error('DATABASE_URL and TEST_DATABASE_URL must identify the same isolated target')
}

const env = loadEnv({
  ACCESS_TOKEN_TTL_SECONDS: '900',
  ANTI_ABUSE_REGISTRATION_DEVICE_LIMIT: '1000',
  ANTI_ABUSE_REGISTRATION_IP_LIMIT: '1000',
  AUTH_RATE_LIMIT_MAX: '100000',
  CORS_ORIGINS: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  DATABASE_URL: databaseUrl,
  JWT_SECRET: 'local-benchmark-secret-0123456789abcdef0123456789abcdef',
  MAIL_SMTP_ENABLED: 'false',
  NODE_ENV: 'test',
  PORT: '3000',
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'x-test-client-ip',
  TRUST_PROXY: 'true',
  WEBAPP_ORIGIN: 'http://localhost:5173',
})

type ApiInstance = ReturnType<typeof createApiInstance>
type Actor = {
  accessToken: string
  user: { id: string }
}
type TimedResponse = {
  durationMs: number
  retryAfterSeconds: number | null
  status: number
}

const prismaA = createPrisma(databaseUrl)
const prismaB = createPrisma(databaseUrl)
const instances: ApiInstance[] = []

try {
  await clearScenarioState(prismaA)
  instances.push(createApiInstance(prismaA, env), createApiInstance(prismaB, env))
  await Promise.all(instances.map(({ baseUrl }) => fetch(`${baseUrl}/health/ready`)))

  const scenarios = {
    auth_wrong_password_budget: await validateWrongPasswordBudget(instances, prismaA),
    auth_shared_nat_budget: await validateSharedNatBudget(instances, prismaA),
    authenticated_mutation_budget: await validateAuthenticatedMutationBudget(prismaA),
    feedback_account_budget: await validateFeedbackAccountBudget(instances, prismaA),
    feedback_ip_budget: await validateFeedbackIpBudget(instances, prismaA),
    room_join_budget: await validateRoomJoinBudget(instances, prismaA),
    tender_command_budget: await validateTenderCommandBudget(instances, prismaA),
    fake_mail_delivery_budget: await validateFakeMailBudget(prismaA, prismaB),
    realtime_ticket_budget: await validateRealtimeTicketBudget(instances, prismaA),
    realtime_invalid_ticket_churn: await validateInvalidRealtimeTicketChurn(
      instances,
      prismaA,
    ),
    realtime_cross_instance_recovery: await validateRealtimeCrossInstanceRecovery(
      instances,
      prismaA,
    ),
    realtime_subscription_cap: await validateRealtimeSubscriptionCap(prismaA),
    ...await validateArgonScenarios(instances, prismaA),
    email_password_reset: await validateEmailPasswordReset(instances, prismaA),
    recovery_code_password_reset: await validateRecoveryCodePasswordReset(
      instances,
      prismaA,
    ),
  }
  const scenarioIds = [...LOCAL_ABUSE_PERFORMANCE_SCENARIOS] as string[]
  if (
    Object.keys(scenarios).length !== scenarioIds.length
    || scenarioIds.some((id) => !(id in scenarios))
  ) {
    throw new Error('Local benchmark scenario implementation does not match its manifest')
  }

  process.stdout.write(`${JSON.stringify({
    environment: {
      architecture: process.arch,
      bunVersion: Bun.version,
      platform: process.platform,
      topology: 'two_loopback_api_listeners_two_prisma_pools_one_isolated_postgresql',
    },
    evidenceVersion: 1,
    kind: 'local_abuse_performance_driver',
    scenarioIds,
    scenarios,
    scope: 'local_isolated',
  })}\n`)
} finally {
  await Promise.all(instances.map((instance) => instance.stop()))
  await Promise.all([prismaA.$disconnect(), prismaB.$disconnect()])
}

function createApiInstance(prisma: DbClient, appEnv: AppEnv) {
  let realtime: RealtimeHub
  let tenderViewReads = 0
  const baseTender = createTenderModule({
    onTenderChanged: (tenderId) => {
      void realtime?.handleTenderChanged(tenderId)
    },
    store: createPrismaTenderStore(prisma),
  })
  const tender: typeof baseTender = {
    ...baseTender,
    readTenderView(input) {
      tenderViewReads += 1
      return baseTender.readTenderView(input)
    },
  }
  const sessionGuard = createPrismaActiveSessionGuard(prisma, {
    sessionAbsoluteTtlDays: appEnv.SESSION_ABSOLUTE_TTL_DAYS,
  })
  realtime = createRealtimeHub({ sessionGuard, tender })
  const ticketStore = createPrismaRealtimeTicketStore(prisma, {
    sessionAbsoluteTtlDays: appEnv.SESSION_ABSOLUTE_TTL_DAYS,
  })
  const app = createApp({
    env: appEnv,
    logoutCleanup: ({ sessionId }) => realtime.closeSession(sessionId),
    prisma,
    securityEvents: { emit() {} },
    tender,
  })
  const server = Bun.serve<RealtimeSocketData>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, bunServer) {
      if (new URL(request.url).pathname === '/api/realtime/ws') {
        return upgradeRealtimeWebSocket({
          hub: realtime,
          request,
          server: bunServer,
          ticketStore,
        })
      }
      return app.fetch(request)
    },
    websocket: createRealtimeWebSocketHandlers({ hub: realtime }),
  })

  return {
    app,
    baseUrl: `http://127.0.0.1:${server.port}`,
    getTenderViewReadCount: () => tenderViewReads,
    realtime,
    tender,
    wsUrl: `ws://127.0.0.1:${server.port}`,
    async stop() {
      return server.stop(true)
    },
  }
}

async function validateWrongPasswordBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearBudgets(prisma, ['login_failure', 'login_ip_attempt'])
  await register(apiInstances[0]!, 'benchmark-auth-wrong', '198.51.100.10')
  const batch = await timedBatch(Array.from({ length: 6 }, (_, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/auth/token/login`,
    {
      body: JSON.stringify({ login: 'benchmark-auth-wrong', password: 'wrong-value' }),
      headers: jsonHeaders(`198.51.100.${20 + index}`),
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 401: 5, 429: 1 })
  return passedBatch(batch)
}

async function validateSharedNatBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearBudgets(prisma, ['login_failure', 'login_ip_attempt'])
  await register(apiInstances[0]!, 'benchmark-auth-nat', '198.51.100.40')
  const batch = await timedBatch(Array.from({ length: 30 }, (_, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/auth/token/login`,
    {
      body: JSON.stringify({ login: 'benchmark-auth-nat', password: benchmarkPassword }),
      headers: jsonHeaders('198.51.100.50'),
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 200: 30 })
  const boundary = await timedFetch(`${apiInstances[0]!.baseUrl}/api/auth/token/login`, {
    body: JSON.stringify({ login: 'benchmark-auth-nat', password: benchmarkPassword }),
    headers: jsonHeaders('198.51.100.50'),
    method: 'POST',
  })
  assertStatuses([boundary], { 429: 1 })
  return {
    ...passedBatch(batch),
    boundaryDurationMs: round(boundary.durationMs),
    boundaryRetryAfterSeconds: boundary.retryAfterSeconds,
    boundaryStatus: boundary.status,
  }
}

async function validateAuthenticatedMutationBudget(prisma: DbClient) {
  await clearBudgets(prisma, ['authenticated_mutation', 'room_join', 'realtime_ticket_issue'])
  const constrained = createApp({
    env: { ...env, ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT: 1 },
    prisma,
    securityEvents: { emit() {} },
  })
  const actor = await registerDirect(constrained, 'benchmark-generic-budget')
  const accepted = await constrained.request('/api/auth/profile', {
    body: JSON.stringify({ displayName: 'Исследователь' }),
    headers: authorizedJsonHeaders(actor.accessToken),
    method: 'PATCH',
  })
  const blocked = await Promise.all([
    constrained.request('/api/rooms/join', {
      body: JSON.stringify({ code: 'ABCDEFGHJK' }),
      headers: authorizedJsonHeaders(actor.accessToken),
      method: 'POST',
    }),
    constrained.request('/api/realtime/tickets', {
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      method: 'POST',
    }),
  ])
  const specificRows = await prisma.authAbuseBucket.count({
    where: { scope: { in: ['room_join', 'realtime_ticket_issue'] } },
  })
  if (accepted.status !== 204 || blocked.some((response) => response.status !== 429)) {
    throw new Error('Authenticated mutation boundary mismatch')
  }
  if (specificRows !== 0) throw new Error('Specific budgets were consumed after generic rejection')
  await Promise.all([accepted.arrayBuffer(), ...blocked.map((response) => response.arrayBuffer())])
  return {
    assertionsPassed: true,
    blockedStatuses: blocked.map((response) => response.status),
    firstStatus: accepted.status,
    specificBudgetRowsAfterRejection: specificRows,
  }
}

async function validateFeedbackAccountBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearFeedback(prisma)
  const actor = await register(apiInstances[0]!, 'benchmark-feedback-account', '198.51.100.60')
  const batch = await timedBatch(Array.from({ length: 6 }, (_, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/feedback`,
    {
      body: JSON.stringify(feedbackReport()),
      headers: authorizedJsonHeaders(actor.accessToken, `198.51.100.${70 + index}`),
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 201: 5, 429: 1 })
  const stored = await prisma.feedbackReport.count()
  if (stored !== 5) throw new Error('Feedback account budget persisted an unexpected count')
  return { ...passedBatch(batch), persistedReports: stored }
}

async function validateFeedbackIpBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearFeedback(prisma)
  const actors: Actor[] = []
  for (let index = 0; index < 21; index += 1) {
    actors.push(await register(
      apiInstances[index % 2]!,
      `benchmark-feedback-ip-${index}`,
      `203.0.113.${index + 1}`,
    ))
  }
  const batch = await timedBatch(actors.map((actor, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/feedback`,
    {
      body: JSON.stringify(feedbackReport()),
      headers: authorizedJsonHeaders(actor.accessToken, '198.51.100.90'),
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 201: 20, 429: 1 })
  const stored = await prisma.feedbackReport.count()
  if (stored !== 20) throw new Error('Feedback IP budget persisted an unexpected count')
  return { ...passedBatch(batch), persistedReports: stored }
}

async function validateRoomJoinBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearBudgets(prisma, ['authenticated_mutation', 'room_join'])
  const actor = await register(apiInstances[0]!, 'benchmark-room', '198.51.100.100')
  const batch = await timedBatch(Array.from({ length: 21 }, (_, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/rooms/join`,
    {
      body: JSON.stringify({ code: 'ABCDEFGHJK' }),
      headers: authorizedJsonHeaders(actor.accessToken),
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 404: 20, 429: 1 })
  return passedBatch(batch)
}

async function validateTenderCommandBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearBudgets(prisma, ['authenticated_mutation', 'tender_command'])
  const actor = await register(apiInstances[0]!, 'benchmark-tender-actor', '198.51.100.110')
  const opponent = await register(apiInstances[1]!, 'benchmark-tender-opponent', '198.51.100.111')
  const { tenderId } = await apiInstances[0]!.tender.createTender({
    players: [
      { id: actor.user.id, tiePriority: 1 },
      { id: opponent.user.id, tiePriority: 2 },
    ],
  })
  const body = JSON.stringify({
    actorId: actor.user.id,
    commandId: crypto.randomUUID(),
    slot: 3,
    tenderId,
    type: 'request-access-slot',
  })
  const batch = await timedBatch(Array.from({ length: 61 }, (_, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/tenders/${tenderId}/commands`,
    {
      body,
      headers: authorizedJsonHeaders(actor.accessToken),
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 200: 60, 429: 1 })
  return passedBatch(batch)
}

async function validateFakeMailBudget(prismaOne: DbClient, prismaTwo: DbClient) {
  await prismaOne.mailDeliveryAttempt.deleteMany()
  await prismaOne.mailOutboxMessage.deleteMany()
  await prismaOne.mailDeliveryProtectionAlert.deleteMany()
  await prismaOne.mailDeliveryControl.deleteMany()
  await clearBudgets(prismaOne, ['smtp_delivery_global_minute'])
  const writer = createPrismaTransactionalMailWriter(prismaOne)
  const now = new Date()
  const enqueueStartedAt = performance.now()
  for (let index = 0; index < 61; index += 1) {
    await writer.enqueue({
      fingerprint: index.toString(16).padStart(64, '0'),
      messageId: crypto.randomUUID(),
      recipient: `local-benchmark-${index}@example.test`,
      recipientDomain: 'example.test',
      template: {
        event: 'password_changed',
        kind: 'security_notification',
        occurredAt: now.toISOString(),
      },
    })
  }
  const enqueueDurationMs = performance.now() - enqueueStartedAt
  const options = {
    circuitFailureThreshold: 5,
    circuitOpenMs: 300_000,
    deliveryBudgetPerMinute: 60,
    leaseMs: 60_000,
    maxAttempts: 5,
    retryBaseMs: 30_000,
  }
  const serviceFor = (prisma: DbClient) => new TransactionalMailDeliveryService({
    confirmationCodeSecret: env.JWT_SECRET,
    delivery: { send: async () => ({ kind: 'accepted' as const }) },
    policy: {
      evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }),
    },
    repository: createPrismaMailOutboxRepository(prisma, options),
  })
  const startedAt = performance.now()
  const drains = await Promise.all([
    serviceFor(prismaOne).drain({ limit: 100, now: new Date(), workerId: 'local-worker-a' }),
    serviceFor(prismaTwo).drain({ limit: 100, now: new Date(), workerId: 'local-worker-b' }),
  ])
  const durationMs = performance.now() - startedAt
  const accepted = drains.reduce((total, drain) => total + drain.accepted, 0)
  const attempts = await prismaOne.mailDeliveryAttempt.count()
  const alerts = await prismaOne.mailDeliveryProtectionAlert.count()
  if (accepted !== 60 || attempts !== 60 || alerts !== 1) {
    throw new Error('Fake mail delivery budget boundary mismatch')
  }
  return {
    accepted,
    assertionsPassed: true,
    deliveryAttempts: attempts,
    durationMs: round(durationMs),
    enqueueDurationMs: round(enqueueDurationMs),
    protectionAlerts: alerts,
    queuedAfterBoundary: await prismaOne.mailOutboxMessage.count({ where: { state: 'queued' } }),
  }
}

async function validateRealtimeTicketBudget(apiInstances: ApiInstance[], prisma: DbClient) {
  await clearBudgets(prisma, ['authenticated_mutation', 'realtime_ticket_issue'])
  await prisma.realtimeTicket.deleteMany()
  const actor = await register(apiInstances[0]!, 'benchmark-realtime-ticket', '198.51.100.120')
  const batch = await timedBatch(Array.from({ length: 10 }, (_, index) => () => timedFetch(
    `${apiInstances[index % 2]!.baseUrl}/api/realtime/tickets`,
    {
      headers: { Authorization: `Bearer ${actor.accessToken}` },
      method: 'POST',
    },
  )))
  assertStatuses(batch.responses, { 201: 10 })
  const boundary = await timedFetch(`${apiInstances[0]!.baseUrl}/api/realtime/tickets`, {
    headers: { Authorization: `Bearer ${actor.accessToken}` },
    method: 'POST',
  })
  assertStatuses([boundary], { 429: 1 })
  return {
    ...passedBatch(batch),
    boundaryRetryAfterSeconds: boundary.retryAfterSeconds,
    boundaryStatus: boundary.status,
  }
}

async function validateInvalidRealtimeTicketChurn(
  apiInstances: ApiInstance[],
  prisma: DbClient,
) {
  await clearBudgets(prisma, ['realtime_ticket_issue'])
  await prisma.realtimeTicket.deleteMany()
  const actor = await register(apiInstances[0]!, 'benchmark-realtime-invalid-a', '198.51.100.130')
  const opponent = await register(apiInstances[1]!, 'benchmark-realtime-invalid-b', '198.51.100.131')
  const { tenderId } = await apiInstances[0]!.tender.createTender({
    players: [
      { id: actor.user.id, tiePriority: 1 },
      { id: opponent.user.id, tiePriority: 2 },
    ],
  })
  const budgetRowsBefore = await prisma.authAbuseBucket.count({
    where: { scope: 'realtime_ticket_issue' },
  })
  const [batch, health] = await Promise.all([
    timedBatch(Array.from({ length: 100 }, (_, index) => () => timedFetch(
      `${apiInstances[index % 2]!.baseUrl}/api/realtime/ws?ticket=${crypto.randomUUID()}&tenderId=${tenderId}`,
    ))),
    timedBatch(Array.from({ length: 20 }, (_, index) => () => timedFetch(
      `${apiInstances[index % 2]!.baseUrl}/health/ready`,
    ))),
  ])
  assertStatuses(batch.responses, { 401: 100 })
  assertStatuses(health.responses, { 200: 20 })
  const budgetRowsAfter = await prisma.authAbuseBucket.count({
    where: { scope: 'realtime_ticket_issue' },
  })
  if (budgetRowsAfter !== budgetRowsBefore) {
    throw new Error('Invalid realtime ticket churn changed the ticket-issue budget')
  }
  return {
    ...passedBatch(batch),
    health: passedBatch(health),
    ticketBudgetRowsAfter: budgetRowsAfter,
    ticketBudgetRowsBefore: budgetRowsBefore,
  }
}

async function validateRealtimeCrossInstanceRecovery(
  apiInstances: ApiInstance[],
  prisma: DbClient,
) {
  await clearBudgets(prisma, [
    'authenticated_mutation',
    'realtime_ticket_issue',
    'tender_command',
  ])
  await prisma.realtimeTicket.deleteMany()
  const actor = await register(apiInstances[0]!, 'benchmark-realtime-cross-a', '198.51.100.135')
  const opponent = await register(apiInstances[1]!, 'benchmark-realtime-cross-b', '198.51.100.136')
  const { tenderId } = await apiInstances[0]!.tender.createTender({
    players: [
      { id: actor.user.id, tiePriority: 1 },
      { id: opponent.user.id, tiePriority: 2 },
    ],
  })

  const firstTicket = await issueRealtimeTicket(apiInstances[1]!, actor.accessToken)
  const first = await openSocket(
    `${apiInstances[0]!.wsUrl}/api/realtime/ws?ticket=${encodeURIComponent(firstTicket)}&tenderId=${tenderId}`,
  )
  const update = waitForTenderVersion(first.socket, 1)
  const updateStartedAt = performance.now()
  const command = await timedFetch(
    `${apiInstances[1]!.baseUrl}/api/tenders/${tenderId}/commands`,
    {
      body: JSON.stringify({
        actorId: actor.user.id,
        commandId: crypto.randomUUID(),
        slot: 3,
        tenderId,
        type: 'request-access-slot',
      }),
      headers: authorizedJsonHeaders(actor.accessToken),
      method: 'POST',
    },
  )
  if (command.status !== 200) throw new Error('Cross-instance Tender command failed')
  await apiInstances[0]!.realtime.syncActiveTenders()
  const updateVersion = await update
  const updateDurationMs = performance.now() - updateStartedAt
  first.socket.close()

  const secondTicket = await issueRealtimeTicket(apiInstances[0]!, actor.accessToken)
  const reconnected = await openSocket(
    `${apiInstances[1]!.wsUrl}/api/realtime/ws?ticket=${encodeURIComponent(secondTicket)}&tenderId=${tenderId}`,
  )
  const reconnectVersion = tenderVersionFromMessage(reconnected.message)
  reconnected.socket.close()
  if (updateVersion !== 1 || reconnectVersion !== 1) {
    throw new Error('Cross-instance realtime recovery returned an unexpected version')
  }
  return {
    assertionsPassed: true,
    commandStatus: command.status,
    reconnectDurationMs: round(reconnected.durationMs),
    reconnectVersion,
    updateDurationMs: round(updateDurationMs),
    updateVersion,
  }
}

async function validateRealtimeSubscriptionCap(prisma: DbClient) {
  await clearBudgets(prisma, ['authenticated_mutation', 'realtime_ticket_issue'])
  await prisma.realtimeTicket.deleteMany()
  const capEnv: AppEnv = { ...env, ANTI_ABUSE_REALTIME_TICKET_LIMIT: 20 }
  const instance = createApiInstance(prisma, capEnv)
  const sockets: WebSocket[] = []
  try {
    const actor = await register(instance, 'benchmark-realtime-cap-a', '198.51.100.140')
    const opponent = await register(instance, 'benchmark-realtime-cap-b', '198.51.100.141')
    const { tenderId } = await instance.tender.createTender({
      players: [
        { id: actor.user.id, tiePriority: 1 },
        { id: opponent.user.id, tiePriority: 2 },
      ],
    })
    const startedAt = performance.now()
    for (let index = 0; index < 10; index += 1) {
      const ticket = await issueRealtimeTicket(instance, actor.accessToken)
      const opened = await openSocket(
        `${instance.wsUrl}/api/realtime/ws?ticket=${encodeURIComponent(ticket)}&tenderId=${tenderId}`,
      )
      sockets.push(opened.socket)
    }
    const readsAfterTen = instance.getTenderViewReadCount()
    const eleventhTicket = await issueRealtimeTicket(instance, actor.accessToken)
    const rejected = await waitForSocketClose(
      `${instance.wsUrl}/api/realtime/ws?ticket=${encodeURIComponent(eleventhTicket)}&tenderId=${tenderId}`,
    )
    const readsAfterRejection = instance.getTenderViewReadCount()
    const readsBeforeSync = instance.getTenderViewReadCount()
    await instance.realtime.syncActiveTenders()
    const readsPerSync = instance.getTenderViewReadCount() - readsBeforeSync
    const originalSocketsOpen = sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length
    if (
      readsAfterTen !== 10
      || readsAfterRejection !== 10
      || rejected.code !== 4429
      || readsPerSync !== 10
      || originalSocketsOpen !== 10
    ) {
      throw new Error('Realtime per-process subscription cap boundary mismatch')
    }
    return {
      activeSubscriptions: originalSocketsOpen,
      assertionsPassed: true,
      durationMs: round(performance.now() - startedAt),
      initialViewReads: readsAfterTen,
      rejectedCloseCode: rejected.code,
      viewReadsAfterRejectedSubscription: readsAfterRejection,
      viewReadsPerSync: readsPerSync,
    }
  } finally {
    for (const socket of sockets) socket.close()
    await instance.stop()
  }
}

async function validateArgonScenarios(apiInstances: ApiInstance[], prisma: DbClient) {
  const newHashes = await measureDurations(3, async () => {
    const hash = await hashPassword(benchmarkPassword)
    if (passwordHashNeedsRehash(hash)) throw new Error('New Argon2 hash does not meet policy')
    return hash
  })
  const currentHash = newHashes.values[0]!
  const wrong = await measureDurations(3, async () => {
    if (await verifyPassword('wrong-value', currentHash)) {
      throw new Error('Wrong password unexpectedly verified')
    }
  })
  const unknown = await measureDurations(3, async () => {
    if (await verifyPassword('wrong-value', null)) {
      throw new Error('Unknown account fallback unexpectedly verified')
    }
  })

  await clearBudgets(prisma, ['login_failure', 'login_ip_attempt'])
  const actor = await register(apiInstances[0]!, 'benchmark-argon-rehash', '198.51.100.150')
  const weakHash = await Bun.password.hash(benchmarkPassword, {
    algorithm: 'argon2id',
    memoryCost: 32_768,
    timeCost: 1,
  })
  if (!passwordHashNeedsRehash(weakHash)) throw new Error('Weak Argon2 fixture is not weak')
  await prisma.user.update({
    data: { passwordHash: weakHash },
    where: { id: actor.user.id },
  })
  const login = await timedFetch(`${apiInstances[0]!.baseUrl}/api/auth/token/login`, {
    body: JSON.stringify({ login: 'benchmark-argon-rehash', password: benchmarkPassword }),
    headers: jsonHeaders('198.51.100.151'),
    method: 'POST',
  })
  const upgradedHash = (await prisma.user.findUniqueOrThrow({
    select: { passwordHash: true },
    where: { id: actor.user.id },
  })).passwordHash
  if (login.status !== 200 || !upgradedHash || passwordHashNeedsRehash(upgradedHash)) {
    throw new Error('Opportunistic Argon2 rehash did not complete')
  }

  return {
    argon2_new_hash: {
      assertionsPassed: true,
      latency: summarizeDurations(newHashes.durations),
      policyMemoryKiB: 65_536,
      policyParallelism: 1,
      policyTimeCost: 2,
      processCpuMs: newHashes.processCpuMs,
      processRssEndBytes: newHashes.processRssEndBytes,
      processRssPeakBytes: newHashes.processRssPeakBytes,
      processRssStartBytes: newHashes.processRssStartBytes,
      samples: newHashes.durations.length,
    },
    argon2_wrong_password_verify: {
      assertionsPassed: true,
      latency: summarizeDurations(wrong.durations),
      processCpuMs: wrong.processCpuMs,
      processRssPeakBytes: wrong.processRssPeakBytes,
      samples: wrong.durations.length,
      verified: false,
    },
    argon2_unknown_account_verify: {
      assertionsPassed: true,
      latency: summarizeDurations(unknown.durations),
      processCpuMs: unknown.processCpuMs,
      processRssPeakBytes: unknown.processRssPeakBytes,
      samples: unknown.durations.length,
      verified: false,
    },
    argon2_opportunistic_rehash: {
      assertionsPassed: true,
      durationMs: round(login.durationMs),
      rehashCompleted: true,
      status: login.status,
    },
  }
}

async function validateEmailPasswordReset(apiInstances: ApiInstance[], prisma: DbClient) {
  await ensureApprovedMailService(prisma)
  await clearBudgets(prisma, [
    'password_reset_ip_day',
    'password_reset_ip_hour',
    'password_reset_login_day',
    'password_reset_login_hour',
  ])
  const actor = await register(apiInstances[0]!, 'benchmark-email-reset', '198.51.100.160')
  await seedRecoveryEmail(prisma, actor.user.id, 'benchmark-email-reset@mail.ru')
  const requested = await apiInstances[0]!.app.request('/api/auth/password-recovery/request', {
    body: JSON.stringify({ login: 'benchmark-email-reset' }),
    headers: jsonHeaders('198.51.100.161'),
    method: 'POST',
  })
  if (requested.status !== 200) throw new Error('Email password reset request failed')
  await requested.arrayBuffer()
  const credential = await prisma.passwordResetCredential.findUniqueOrThrow({
    select: { messageId: true },
    where: { userId: actor.user.id },
  })
  const derivedValue = derivePasswordResetToken(env.JWT_SECRET, credential.messageId)
  const startedAt = performance.now()
  const completed = await apiInstances[1]!.app.request('/api/auth/password-recovery/complete', {
    body: JSON.stringify({ newPassword: 'local-reset-password123', token: derivedValue }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const durationMs = performance.now() - startedAt
  const body = await completed.json() as { outcome?: unknown }
  const stored = await prisma.user.findUniqueOrThrow({
    select: { passwordHash: true },
    where: { id: actor.user.id },
  })
  const changed = await verifyPassword('local-reset-password123', stored.passwordHash)
  const credentialsRemaining = await prisma.passwordResetCredential.count({
    where: { userId: actor.user.id },
  })
  const sessionsRemaining = await prisma.authSession.count({
    where: { revokedAt: null, userId: actor.user.id },
  })
  if (
    completed.status !== 200
    || body.outcome !== 'completed'
    || !changed
    || credentialsRemaining !== 0
    || sessionsRemaining !== 0
  ) {
    throw new Error('Email password reset completion mismatch')
  }
  return {
    assertionsPassed: true,
    credentialsRemaining,
    durationMs: round(durationMs),
    outcome: body.outcome,
    priorSessionsRemaining: sessionsRemaining,
    status: completed.status,
  }
}

async function validateRecoveryCodePasswordReset(apiInstances: ApiInstance[], prisma: DbClient) {
  await ensureApprovedMailService(prisma)
  const actor = await register(apiInstances[0]!, 'benchmark-recovery-code', '198.51.100.170')
  await seedRecoveryEmail(prisma, actor.user.id, 'benchmark-recovery-code@mail.ru')
  const issued = await apiInstances[0]!.app.request(
    '/api/auth/account-protection/recovery-codes/issue',
    {
      body: '{}',
      headers: authorizedJsonHeaders(actor.accessToken, '198.51.100.171'),
      method: 'POST',
    },
  )
  if (issued.status !== 200) throw new Error('Recovery Code issuance failed')
  const issuedBody = await issued.json() as { recoveryCodes?: unknown }
  if (!Array.isArray(issuedBody.recoveryCodes) || typeof issuedBody.recoveryCodes[0] !== 'string') {
    throw new Error('Recovery Code issuance returned an invalid result')
  }
  const startedAt = performance.now()
  const completed = await apiInstances[1]!.app.request('/api/auth/recovery-code/password', {
    body: JSON.stringify({
      login: 'benchmark-recovery-code',
      newPassword: 'local-recovery-code-password123',
      recoveryCode: issuedBody.recoveryCodes[0],
    }),
    headers: jsonHeaders('198.51.100.172'),
    method: 'POST',
  })
  const durationMs = performance.now() - startedAt
  const body = await completed.json() as { outcome?: unknown }
  const codesRemaining = await prisma.recoveryCode.count({ where: { userId: actor.user.id } })
  const sessionsRemaining = await prisma.authSession.count({
    where: { revokedAt: null, userId: actor.user.id },
  })
  const stored = await prisma.user.findUniqueOrThrow({
    select: { passwordHash: true },
    where: { id: actor.user.id },
  })
  const changed = await verifyPassword('local-recovery-code-password123', stored.passwordHash)
  if (
    completed.status !== 200
    || body.outcome !== 'completed'
    || codesRemaining !== 0
    || sessionsRemaining !== 0
    || !changed
  ) {
    throw new Error('Recovery Code password reset completion mismatch')
  }
  return {
    assertionsPassed: true,
    codesRemaining,
    durationMs: round(durationMs),
    outcome: body.outcome,
    priorSessionsRemaining: sessionsRemaining,
    status: completed.status,
  }
}

async function ensureApprovedMailService(prisma: DbClient) {
  if (await prisma.mailPolicyVersion.count() > 0) return
  const sourceImport = await prisma.mailRegistryImport.create({
    data: {
      actorId: crypto.randomUUID(),
      addedDomains: ['mail.ru'],
      checksum: 'a'.repeat(64),
      outcome: 'succeeded',
      removedDomains: [],
      sourceDate: '2026-08-25',
      sourceUrl: 'https://example.test/registry.xml',
      unchangedCount: 0,
    },
  })
  const candidate = await prisma.mailRegistryCandidate.create({
    data: {
      evidence: 'service_description_mentions_mail',
      importId: sourceImport.id,
      registryEntryId: 'local-benchmark-mail-service',
      serviceDomain: 'mail.ru',
    },
  })
  await prisma.mailPolicyVersion.create({
    data: {
      entries: {
        create: {
          emailDomain: 'mail.ru',
          ignoreDots: false,
          localPartCaseInsensitive: true,
          sourceCandidateId: candidate.id,
          state: 'approved',
          stripPlusTag: false,
        },
      },
      publishedBy: crypto.randomUUID(),
      version: 1,
    },
  })
}

async function seedRecoveryEmail(prisma: DbClient, userId: string, value: string) {
  await prisma.recoveryEmailBinding.create({
    data: {
      activatesAt: new Date(Date.now() - 60_000),
      cancellationSessionIds: [],
      canonicalKey: value.toLowerCase(),
      policyVersion: 1,
      providerValue: value,
      requestedAt: new Date(Date.now() - 86_400_000),
      userId,
    },
  })
}

async function clearScenarioState(prisma: DbClient) {
  await prisma.feedbackAuditEvent.deleteMany()
  await prisma.feedbackOperatorCommand.deleteMany()
  await prisma.feedbackReport.deleteMany()
  await prisma.mailDeliveryAttempt.deleteMany()
  await prisma.mailOutboxMessage.deleteMany()
  await prisma.mailDeliveryProtectionAlert.deleteMany()
  await prisma.mailDeliveryControl.deleteMany()
  await prisma.realtimeTicket.deleteMany()
  await prisma.authAbuseBucket.deleteMany()
  await prisma.tenderRoomMember.deleteMany()
  await prisma.tenderRoom.deleteMany()
  await prisma.tender.deleteMany()
  await prisma.user.deleteMany()
}

async function clearBudgets(prisma: DbClient, scopes: string[]) {
  await prisma.authAbuseBucket.deleteMany({ where: { scope: { in: scopes } } })
}

async function clearFeedback(prisma: DbClient) {
  await prisma.feedbackAuditEvent.deleteMany()
  await prisma.feedbackOperatorCommand.deleteMany()
  await prisma.feedbackReport.deleteMany()
  await clearBudgets(prisma, [
    'authenticated_mutation',
    'feedback_account_day',
    'feedback_ip_day',
  ])
}

function feedbackReport() {
  return {
    category: 'error',
    canContinue: false,
    expectedResult: 'Карточка должна открыться.',
    linkAccount: false,
    replyEmail: null,
    reproductionSteps: 'Открыл матч и нажал на карточку.',
    technicalContext: {
      browserClass: 'chromium',
      buildSha: 'a'.repeat(40),
      deviceClass: 'desktop',
      errorId: null,
      routeTemplate: '/tenders/$tenderId',
    },
    whatHappened: 'Карточка не открылась.',
  }
}

async function register(instance: ApiInstance, login: string, clientAddress?: string) {
  const response = await fetch(`${instance.baseUrl}/api/auth/token/register`, {
    body: JSON.stringify(registrationPayload(login)),
    headers: jsonHeaders(clientAddress),
    method: 'POST',
  })
  if (response.status !== 201) throw new Error(`Registration failed with status ${response.status}`)
  const body = await response.json() as {
    accessToken?: unknown
    user?: { id?: unknown }
  }
  if (typeof body.accessToken !== 'string' || typeof body.user?.id !== 'string') {
    throw new Error('Registration returned an invalid result')
  }
  return { accessToken: body.accessToken, user: { id: body.user.id } }
}

async function registerDirect(app: ReturnType<typeof createApp>, login: string) {
  const response = await app.request('/api/auth/token/register', {
    body: JSON.stringify(registrationPayload(login)),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (response.status !== 201) throw new Error(`Registration failed with status ${response.status}`)
  const body = await response.json() as {
    accessToken?: unknown
    user?: { id?: unknown }
  }
  if (typeof body.accessToken !== 'string' || typeof body.user?.id !== 'string') {
    throw new Error('Registration returned an invalid result')
  }
  return { accessToken: body.accessToken, user: { id: body.user.id } }
}

function registrationPayload(login: string) {
  return {
    login,
    password: benchmarkPassword,
    privacyConsent: true,
    privacyConsentVersion: '1.1',
    termsAccepted: true,
    termsVersion: '1.1',
  }
}

function jsonHeaders(clientAddress?: string) {
  return {
    'Content-Type': 'application/json',
    ...(clientAddress ? { 'x-test-client-ip': clientAddress } : {}),
  }
}

function authorizedJsonHeaders(accessToken: string, clientAddress?: string) {
  return {
    ...jsonHeaders(clientAddress),
    Authorization: `Bearer ${accessToken}`,
  }
}

async function timedBatch(factories: Array<() => Promise<TimedResponse>>) {
  const startedAt = performance.now()
  const responses = await Promise.all(factories.map((factory) => factory()))
  return { durationMs: performance.now() - startedAt, responses }
}

async function timedFetch(url: string, init?: RequestInit): Promise<TimedResponse> {
  const startedAt = performance.now()
  const response = await fetch(url, init)
  const result = {
    durationMs: performance.now() - startedAt,
    retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    status: response.status,
  }
  await response.arrayBuffer()
  return result
}

function passedBatch(batch: Awaited<ReturnType<typeof timedBatch>>) {
  const statuses: Record<string, number> = {}
  for (const response of batch.responses) {
    statuses[response.status] = (statuses[response.status] ?? 0) + 1
  }
  return {
    assertionsPassed: true,
    batchDurationMs: round(batch.durationMs),
    effectiveRequestsPerSecond: round(batch.responses.length / (batch.durationMs / 1_000)),
    latency: summarizeDurations(batch.responses.map((response) => response.durationMs)),
    retryAfterSeconds: batch.responses
      .map((response) => response.retryAfterSeconds)
      .filter((value): value is number => value !== null),
    statuses,
  }
}

function assertStatuses(responses: TimedResponse[], expected: Record<number, number>) {
  const actual: Record<number, number> = {}
  for (const response of responses) actual[response.status] = (actual[response.status] ?? 0) + 1
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`HTTP boundary mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function measureDurations<T>(count: number, operation: () => Promise<T>) {
  const durations: number[] = []
  const values: T[] = []
  const cpuStartedAt = process.cpuUsage()
  const processRssStartBytes = process.memoryUsage.rss()
  let processRssPeakBytes = processRssStartBytes
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now()
    values.push(await operation())
    durations.push(performance.now() - startedAt)
    processRssPeakBytes = Math.max(processRssPeakBytes, process.memoryUsage.rss())
  }
  const cpu = process.cpuUsage(cpuStartedAt)
  return {
    durations,
    processCpuMs: round((cpu.user + cpu.system) / 1_000),
    processRssEndBytes: process.memoryUsage.rss(),
    processRssPeakBytes,
    processRssStartBytes,
    values,
  }
}

function summarizeDurations(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    maxMs: round(sorted.at(-1) ?? 0),
    meanMs: round(sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length)),
    p50Ms: round(percentile(sorted, 0.50)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
  }
}

function percentile(sorted: number[], fraction: number) {
  if (sorted.length === 0) return 0
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!
}

function parseRetryAfter(value: string | null) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

async function issueRealtimeTicket(instance: ApiInstance, accessToken: string) {
  const response = await fetch(`${instance.baseUrl}/api/realtime/tickets`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    method: 'POST',
  })
  if (response.status !== 201) throw new Error(`Realtime ticket issuance failed: ${response.status}`)
  const body = await response.json() as { ticket?: unknown }
  if (typeof body.ticket !== 'string') throw new Error('Realtime ticket issuance result was invalid')
  return body.ticket
}

function openSocket(url: string) {
  return new Promise<{ durationMs: number; message: string; socket: WebSocket }>((resolve, reject) => {
    const startedAt = performance.now()
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Realtime greeting timed out'))
    }, 5_000)
    socket.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Realtime connection failed'))
    }
    socket.onmessage = (event) => {
      clearTimeout(timeout)
      socket.onmessage = null
      resolve({
        durationMs: performance.now() - startedAt,
        message: String(event.data),
        socket,
      })
    }
  })
}

function waitForTenderVersion(socket: WebSocket, expectedVersion: number) {
  return new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error('Realtime update timed out'))
    }, 5_000)
    const onMessage = (event: MessageEvent) => {
      const version = tenderVersionFromMessage(String(event.data))
      if (version === null || version < expectedVersion) return
      clearTimeout(timeout)
      socket.removeEventListener('message', onMessage)
      resolve(version)
    }
    socket.addEventListener('message', onMessage)
  })
}

function tenderVersionFromMessage(message: string) {
  try {
    const parsed = JSON.parse(message) as { type?: unknown; view?: { version?: unknown } }
    return parsed.type === 'tender-view' && typeof parsed.view?.version === 'number'
      ? parsed.view.version
      : null
  } catch {
    return null
  }
}

function waitForSocketClose(url: string) {
  return new Promise<{ code: number }>((resolve, reject) => {
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Realtime rejection timed out'))
    }, 5_000)
    socket.onerror = () => undefined
    socket.onmessage = () => {
      clearTimeout(timeout)
      socket.close()
      reject(new Error('Rejected realtime subscription received a view'))
    }
    socket.onclose = (event) => {
      clearTimeout(timeout)
      resolve({ code: event.code })
    }
  })
}
