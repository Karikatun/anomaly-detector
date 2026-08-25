import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { createTransactionalMailRequester, derivePasswordResetToken } from '..'
import { TransactionalMailDeliveryService } from '../application/transactional-mail-delivery-service'
import { TransactionalMailService } from '../application/transactional-mail-service'
import type { RenderedTransactionalMail } from '../application/transactional-mail-ports'
import {
  cancelQueuedTransactionalMail,
  createPrismaMailOutboxRepository,
  createPrismaTransactionalMailWriter,
} from './prisma-transactional-mail-outbox'
import { createPrismaMailDeliveryOverviewReader } from './prisma-mail-delivery-overview-reader'
import {
  cleanupExpiredPendingMailOutbox,
  cleanupTerminalMailOutbox,
} from './prisma-mail-outbox-cleanup'

const databaseUrl = process.env.TEST_DATABASE_URL
const fingerprintKey = 'integration-mail-fingerprint-key-0001'
const confirmationCodeSecret = 'integration-mail-confirmation-key-0001'
const maybeDescribe = databaseUrl ? describe : describe.skip
const scenarioStart = new Date(Date.now() + 24 * 60 * 60 * 1_000)
const scenarioTime = (offsetMs = 0) => new Date(scenarioStart.getTime() + offsetMs)

maybeDescribe('Prisma transactional mail outbox', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const createEnqueuer = () => new TransactionalMailService(
    createPrismaTransactionalMailWriter(prisma),
    fingerprintKey,
  )
  const request = {
    messageId: '019f8099-7e26-7760-ad08-66d1d66b2810',
    recipient: 'researcher@yandex.ru',
    template: {
      expiresAt: scenarioTime(15 * 60_000),
      kind: 'account_email_confirmation' as const,
    },
  }

  beforeEach(async () => {
    await prisma.mailDeliveryAttempt.deleteMany()
    await prisma.mailOutboxMessage.deleteMany()
    await prisma.mailDeliveryProtectionAlert.deleteMany()
    await prisma.mailDeliveryControl.deleteMany()
    await prisma.mailDomainAssessment.deleteMany({
      where: { emailDomain: 'outbox-attribution.ru' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('writes atomically with the owner transaction and deduplicates a logical message', async () => {
    await expect(prisma.$transaction(async (tx) => {
      const service = createTransactionalMailRequester(tx, fingerprintKey)
      await service.enqueue(request)
      throw new Error('owner operation rolled back')
    })).rejects.toThrow('owner operation rolled back')
    expect(await prisma.mailOutboxMessage.count()).toBe(0)

    await prisma.$transaction(async (tx) => {
      const service = createTransactionalMailRequester(tx, fingerprintKey)
      await expect(service.enqueue(request)).resolves.toMatchObject({ kind: 'queued' })
      await expect(service.enqueue(request)).resolves.toMatchObject({ kind: 'already_queued' })
    })
    expect(await prisma.mailOutboxMessage.count()).toBe(1)
    expect(await prisma.mailOutboxMessage.findUnique({
      where: { messageId: request.messageId },
      select: { recipientDomain: true, state: true },
    })).toEqual({ recipientDomain: 'yandex.ru', state: 'queued' })
  })

  test('recovers an ambiguous SMTP attempt after restart without changing message identity', async () => {
    const enqueuer = createEnqueuer()
    await enqueuer.enqueue(request)
    const sent: RenderedTransactionalMail[] = []
    let attempts = 0
    const dependencies = {
      confirmationCodeSecret,
      delivery: {
        send: async (message: RenderedTransactionalMail) => {
          sent.push(message)
          attempts += 1
          return attempts === 1
            ? { ambiguous: true, code: 'smtp_response_lost', kind: 'temporary_failure' as const }
            : { kind: 'accepted' as const }
        },
      },
      policy: {
        evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }),
      },
      repository: createPrismaMailOutboxRepository(prisma, {
        circuitFailureThreshold: 3,
        circuitOpenMs: 60_000,
        deliveryBudgetPerMinute: 20,
        leaseMs: 30_000,
        maxAttempts: 3,
        retryBaseMs: 1_000,
      }),
    }

    const firstRuntime = new TransactionalMailDeliveryService(dependencies)
    await expect(firstRuntime.drain({
      limit: 1,
      now: scenarioTime(),
      workerId: 'worker-a',
    })).resolves.toMatchObject({ temporaryFailures: 1 })

    const restartedRuntime = new TransactionalMailDeliveryService(dependencies)
    await expect(restartedRuntime.drain({
      limit: 1,
      now: scenarioTime(1_000),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ accepted: 1 })

    expect(sent).toHaveLength(2)
    expect(sent[0].messageId).toBe(sent[1].messageId)
    expect(sent[0].text).toBe(sent[1].text)
    expect(await prisma.mailDeliveryAttempt.findMany({
      orderBy: { attemptedAt: 'asc' },
      select: { outcome: true },
    })).toEqual([{ outcome: 'temporary_failure' }, { outcome: 'smtp_accepted' }])
    expect(await prisma.mailOutboxMessage.findUnique({
      where: { messageId: request.messageId },
      select: { recipient: true, state: true, templatePayload: true },
    })).toEqual({ recipient: '[redacted]', state: 'smtp_accepted', templatePayload: {} })
  })

  test('does not claim cancellation after a worker has leased the SMTP delivery', async () => {
    const enqueuer = createEnqueuer()
    await enqueuer.enqueue(request)
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const claim = await repository.claim({
      now: scenarioTime(),
      workerId: 'worker-a',
    })
    expect(claim.kind).toBe('claimed')
    if (claim.kind !== 'claimed') throw new Error('Expected a claimed message')

    await expect(prisma.$transaction((tx) => cancelQueuedTransactionalMail(tx, {
      messageId: request.messageId,
      now: scenarioTime(1),
    }))).resolves.toBe(false)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: request.messageId },
      select: { leaseOwner: true, recipient: true, state: true },
    })).toEqual({
      leaseOwner: 'worker-a',
      recipient: request.recipient,
      state: 'leased',
    })

    await expect(repository.recordAccepted({
      id: claim.message.id,
      now: scenarioTime(2),
      workerId: 'worker-a',
    })).resolves.toBe(true)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: request.messageId },
      select: { recipient: true, state: true },
    })).toEqual({ recipient: '[redacted]', state: 'smtp_accepted' })
  })

  test('redacts expired queued and leased mail once under concurrent retention cleanup', async () => {
    const enqueuer = createEnqueuer()
    const cleanupNow = scenarioTime(8 * 24 * 60 * 60_000)
    const expiredConfirmationId = '019f8099-7e26-7760-ad08-66d1d66b2811'
    const expiredLeaseId = '019f8099-7e26-7760-ad08-66d1d66b2812'
    const staleSecurityId = '019f8099-7e26-7760-ad08-66d1d66b2813'
    const futureRecoveryId = '019f8099-7e26-7760-ad08-66d1d66b2814'
    const freshSecurityId = '019f8099-7e26-7760-ad08-66d1d66b2815'

    await enqueuer.enqueue({
      ...request,
      messageId: expiredConfirmationId,
      template: {
        expiresAt: new Date(cleanupNow.getTime() - 1),
        kind: 'account_email_confirmation',
      },
    })
    await enqueuer.enqueue({
      ...request,
      messageId: expiredLeaseId,
      template: {
        expiresAt: new Date(cleanupNow.getTime() - 1),
        kind: 'password_recovery',
        recoveryUrl: 'https://anomaly-detector.ru/recover/password',
      },
    })
    await enqueuer.enqueue({
      messageId: staleSecurityId,
      recipient: request.recipient,
      template: {
        event: 'password_changed',
        kind: 'security_notification',
        occurredAt: new Date(cleanupNow.getTime() - 7 * 24 * 60 * 60_000),
      },
    })
    await enqueuer.enqueue({
      ...request,
      messageId: futureRecoveryId,
      template: {
        expiresAt: new Date(cleanupNow.getTime() + 1),
        kind: 'password_recovery',
        recoveryUrl: 'https://anomaly-detector.ru/recover/password',
      },
    })
    await enqueuer.enqueue({
      messageId: freshSecurityId,
      recipient: request.recipient,
      template: {
        event: 'recovery_email_changed',
        kind: 'security_notification',
        occurredAt: cleanupNow,
      },
    })
    await prisma.mailOutboxMessage.updateMany({
      where: {
        messageId: {
          in: [
            expiredConfirmationId,
            expiredLeaseId,
            futureRecoveryId,
            freshSecurityId,
          ],
        },
      },
      data: { createdAt: cleanupNow },
    })
    await prisma.mailOutboxMessage.update({
      where: { messageId: staleSecurityId },
      data: { createdAt: new Date(cleanupNow.getTime() - 7 * 24 * 60 * 60_000) },
    })
    await prisma.mailOutboxMessage.update({
      where: { messageId: expiredLeaseId },
      data: {
        attemptCount: 1,
        leaseExpiresAt: new Date(cleanupNow.getTime() + 60_000),
        leaseOwner: 'worker-in-flight',
        state: 'leased',
      },
    })

    const results = await Promise.all([
      prisma.$transaction((tx) => cleanupExpiredPendingMailOutbox(tx, cleanupNow)),
      prisma.$transaction((tx) => cleanupExpiredPendingMailOutbox(tx, cleanupNow)),
    ])
    expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(3)
    expect(await prisma.mailOutboxMessage.findMany({
      orderBy: { messageId: 'asc' },
      select: {
        lastFailureCode: true,
        leaseOwner: true,
        messageId: true,
        recipient: true,
        state: true,
        templatePayload: true,
      },
    })).toEqual([
      {
        lastFailureCode: 'retention_expired',
        leaseOwner: null,
        messageId: expiredConfirmationId,
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      },
      {
        lastFailureCode: 'retention_expired',
        leaseOwner: null,
        messageId: expiredLeaseId,
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      },
      {
        lastFailureCode: 'retention_expired',
        leaseOwner: null,
        messageId: staleSecurityId,
        recipient: '[redacted]',
        state: 'terminal_failure',
        templatePayload: {},
      },
      {
        lastFailureCode: null,
        leaseOwner: null,
        messageId: futureRecoveryId,
        recipient: request.recipient,
        state: 'queued',
        templatePayload: {
          expiresAt: new Date(cleanupNow.getTime() + 1).toISOString(),
          kind: 'password_recovery',
          recoveryUrl: 'https://anomaly-detector.ru/recover/password',
        },
      },
      {
        lastFailureCode: null,
        leaseOwner: null,
        messageId: freshSecurityId,
        recipient: request.recipient,
        state: 'queued',
        templatePayload: {
          event: 'recovery_email_changed',
          kind: 'security_notification',
          occurredAt: cleanupNow.toISOString(),
        },
      },
    ])
    expect(await prisma.mailDeliveryAttempt.findMany({
      orderBy: { outboxId: 'asc' },
      select: { failureCode: true, outcome: true },
    })).toEqual([
      { failureCode: 'retention_expired', outcome: 'terminal_failure' },
      { failureCode: 'retention_expired', outcome: 'terminal_failure' },
      { failureCode: 'retention_expired', outcome: 'terminal_failure' },
    ])
  })

  test('does not deliver credential or security mail after its retention deadline', async () => {
    const enqueuer = createEnqueuer()
    const deliveryNow = scenarioTime(8 * 24 * 60 * 60_000)
    const expiredConfirmationId = '019f8099-7e26-7760-ad08-66d1d66b2816'
    const staleSecurityId = '019f8099-7e26-7760-ad08-66d1d66b2817'
    await enqueuer.enqueue({
      ...request,
      messageId: expiredConfirmationId,
      template: {
        expiresAt: deliveryNow,
        kind: 'account_email_confirmation',
      },
    })
    await enqueuer.enqueue({
      messageId: staleSecurityId,
      recipient: request.recipient,
      template: {
        event: 'password_changed',
        kind: 'security_notification',
        occurredAt: new Date(deliveryNow.getTime() - 7 * 24 * 60 * 60_000),
      },
    })
    await prisma.mailOutboxMessage.update({
      where: { messageId: staleSecurityId },
      data: { createdAt: new Date(deliveryNow.getTime() - 7 * 24 * 60 * 60_000) },
    })
    let providerCalls = 0
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: {
        send: async () => {
          providerCalls += 1
          return { kind: 'accepted' }
        },
      },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository: createPrismaMailOutboxRepository(prisma, {
        circuitFailureThreshold: 3,
        circuitOpenMs: 60_000,
        deliveryBudgetPerMinute: 20,
        leaseMs: 30_000,
        maxAttempts: 3,
        retryBaseMs: 1_000,
      }),
    })

    await expect(service.drain({
      limit: 2,
      now: deliveryNow,
      workerId: 'worker-retention',
    })).resolves.toMatchObject({ terminalFailures: 2 })
    expect(providerCalls).toBe(0)
    expect(await prisma.mailOutboxMessage.findMany({
      orderBy: { messageId: 'asc' },
      select: { lastFailureCode: true, recipient: true, state: true },
    })).toEqual([
      {
        lastFailureCode: 'retention_expired',
        recipient: '[redacted]',
        state: 'terminal_failure',
      },
      {
        lastFailureCode: 'retention_expired',
        recipient: '[redacted]',
        state: 'terminal_failure',
      },
    ])
  })

  test('rechecks the deadline after policy evaluation before starting SMTP', async () => {
    const enqueuer = createEnqueuer()
    const deadline = scenarioTime(1_000)
    const messageId = '019f8099-7e26-7760-ad08-66d1d66b2819'
    await enqueuer.enqueue({
      ...request,
      messageId,
      template: {
        expiresAt: deadline,
        kind: 'account_email_confirmation',
      },
    })
    let currentNow = new Date(deadline.getTime() - 1)
    let providerCalls = 0
    const service = new TransactionalMailDeliveryService({
      clock: { now: () => currentNow },
      confirmationCodeSecret,
      delivery: {
        send: async () => {
          providerCalls += 1
          return { kind: 'accepted' }
        },
      },
      policy: {
        evaluate: async () => {
          currentNow = deadline
          return { acceptsNewAddress: true, allowsRecoveryDelivery: true }
        },
      },
      repository: createPrismaMailOutboxRepository(prisma, {
        circuitFailureThreshold: 3,
        circuitOpenMs: 60_000,
        deliveryBudgetPerMinute: 20,
        leaseMs: 30_000,
        maxAttempts: 3,
        retryBaseMs: 1_000,
      }),
    })

    await expect(service.drain({
      limit: 1,
      now: new Date(deadline.getTime() - 1),
      workerId: 'worker-deadline-recheck',
    })).resolves.toMatchObject({ terminalFailures: 1 })
    expect(providerCalls).toBe(0)
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId },
      select: { lastFailureCode: true, recipient: true, state: true },
    })).toEqual({
      lastFailureCode: 'retention_expired',
      recipient: '[redacted]',
      state: 'terminal_failure',
    })
  })

  test('keeps cleanup authoritative when SMTP was already in flight at the deadline', async () => {
    const enqueuer = createEnqueuer()
    const deadline = scenarioTime(1_000)
    const messageId = '019f8099-7e26-7760-ad08-66d1d66b2818'
    await enqueuer.enqueue({
      ...request,
      messageId,
      template: {
        expiresAt: deadline,
        kind: 'account_email_confirmation',
      },
    })
    let markDeliveryStarted: () => void = () => undefined
    let releaseDelivery: () => void = () => undefined
    const deliveryStarted = new Promise<void>((resolve) => {
      markDeliveryStarted = resolve
    })
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve
    })
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: {
        send: async () => {
          markDeliveryStarted()
          await deliveryReleased
          return { kind: 'accepted' }
        },
      },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    })

    const drain = service.drain({
      limit: 1,
      now: new Date(deadline.getTime() - 1),
      workerId: 'worker-in-flight',
    })
    await deliveryStarted
    await prisma.$transaction((tx) => cleanupExpiredPendingMailOutbox(tx, deadline))
    releaseDelivery()

    await expect(drain).resolves.toMatchObject({ accepted: 0, staleClaims: 1 })
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId },
      select: { lastFailureCode: true, recipient: true, state: true },
    })).toEqual({
      lastFailureCode: 'retention_expired',
      recipient: '[redacted]',
      state: 'terminal_failure',
    })
    expect(await prisma.mailDeliveryAttempt.findMany({
      select: { failureCode: true, outcome: true },
    })).toEqual([{ failureCode: 'retention_expired', outcome: 'terminal_failure' }])
  })

  test('reopens the global circuit after a failed recovery probe and closes after success', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['20', '21', '22']) {
      await enqueuer.enqueue({ ...request, messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}` })
    }
    let providerAvailable = false
    let providerCalls = 0
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 2,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: {
        send: async () => {
          providerCalls += 1
          return providerAvailable
            ? { kind: 'accepted' as const }
            : { ambiguous: false, code: 'smtp_unavailable', kind: 'temporary_failure' as const }
        },
      },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    })

    await expect(service.drain({
      limit: 3,
      now: scenarioTime(),
      workerId: 'worker-a',
    })).resolves.toMatchObject({
      circuitOpen: true,
      protectionAlerts: [{
        occurredAt: scenarioTime(),
        reason: 'delivery_circuit_open',
      }],
      temporaryFailures: 2,
    })
    expect(providerCalls).toBe(2)

    await expect(service.drain({
      limit: 1,
      now: scenarioTime(1),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ circuitOpen: true, protectionAlerts: [] })

    await expect(service.drain({
      limit: 1,
      now: scenarioTime(60_000),
      workerId: 'worker-b',
    })).resolves.toMatchObject({
      circuitOpen: true,
      protectionAlerts: [{
        occurredAt: scenarioTime(60_000),
        reason: 'delivery_circuit_open',
      }],
      temporaryFailures: 1,
    })
    expect(providerCalls).toBe(3)
    await expect(service.drain({
      limit: 1,
      now: scenarioTime(60_001),
      workerId: 'worker-c',
    })).resolves.toMatchObject({ circuitOpen: true, protectionAlerts: [] })
    expect(providerCalls).toBe(3)

    providerAvailable = true
    await expect(service.drain({
      limit: 1,
      now: scenarioTime(120_000),
      workerId: 'worker-d',
    })).resolves.toMatchObject({ accepted: 1, circuitOpen: false, protectionAlerts: [] })
    expect(await prisma.mailDeliveryControl.findUnique({
      where: { id: 'reg_ru' },
      select: { circuitOpenUntil: true, consecutiveFailures: true },
    })).toEqual({ circuitOpenUntil: null, consecutiveFailures: 0 })

    providerAvailable = false
    await expect(service.drain({
      limit: 3,
      now: scenarioTime(121_000),
      workerId: 'worker-e',
    })).resolves.toMatchObject({
      circuitOpen: true,
      protectionAlerts: [{
        occurredAt: scenarioTime(121_000),
        reason: 'delivery_circuit_open',
      }],
      temporaryFailures: 2,
    })
    expect(await prisma.mailDeliveryProtectionAlert.findMany({
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true, reason: true, transitionAt: true },
    })).toEqual([
      {
        occurredAt: scenarioTime(),
        reason: 'delivery_circuit_open',
        transitionAt: scenarioTime(60_000),
      },
      {
        occurredAt: scenarioTime(60_000),
        reason: 'delivery_circuit_open',
        transitionAt: scenarioTime(120_000),
      },
      {
        occurredAt: scenarioTime(121_000),
        reason: 'delivery_circuit_open',
        transitionAt: scenarioTime(181_000),
      },
    ])
  })

  test('reopens the circuit after a late in-flight success closes an earlier failure transition', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['23', '24', '25', '26', '27', '28']) {
      await enqueuer.enqueue({ ...request, messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}` })
    }
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 2,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const workerIds = [
      'worker-prefetch-a',
      'worker-prefetch-b',
      'worker-prefetch-c',
      'worker-prefetch-d',
      'worker-prefetch-e',
      'worker-prefetch-f',
    ]
    const claims = await Promise.all(workerIds.map((workerId) => repository.claim({
      now: scenarioTime(),
      workerId,
    })))
    expect(claims.every((claim) => claim.kind === 'claimed')).toBe(true)
    const claimed = claims.map((claim) => {
      if (claim.kind !== 'claimed') throw new Error('Expected every prefetched message to be claimed')
      return claim.message
    })
    const recordProviderFailure = (index: number, now: Date) => repository.recordFailure({
      affectsCircuit: true,
      code: 'smtp_unavailable',
      id: claimed[index]!.id,
      now,
      temporary: true,
      workerId: workerIds[index]!,
    })

    await expect(recordProviderFailure(0, scenarioTime(1))).resolves.toEqual({ state: 'queued' })
    await expect(recordProviderFailure(1, scenarioTime(1))).resolves.toEqual({
      protectionAlert: {
        occurredAt: scenarioTime(1),
        reason: 'delivery_circuit_open',
      },
      state: 'queued',
    })
    await expect(repository.recordAccepted({
      id: claimed[2]!.id,
      now: scenarioTime(2),
      workerId: workerIds[2]!,
    })).resolves.toBe(true)
    expect(await prisma.mailDeliveryControl.findUniqueOrThrow({
      where: { id: 'reg_ru' },
      select: { circuitOpenUntil: true, consecutiveFailures: true },
    })).toEqual({ circuitOpenUntil: null, consecutiveFailures: 0 })

    await expect(recordProviderFailure(3, scenarioTime(3))).resolves.toEqual({ state: 'queued' })
    await expect(recordProviderFailure(4, scenarioTime(3))).resolves.toEqual({
      protectionAlert: {
        occurredAt: scenarioTime(3),
        reason: 'delivery_circuit_open',
      },
      state: 'queued',
    })
    await expect(recordProviderFailure(5, scenarioTime(4))).resolves.toEqual({ state: 'queued' })
    expect(await prisma.mailDeliveryControl.findUniqueOrThrow({
      where: { id: 'reg_ru' },
      select: { circuitOpenUntil: true, consecutiveFailures: true },
    })).toEqual({
      circuitOpenUntil: scenarioTime(60_003),
      consecutiveFailures: 3,
    })
    const alerts = await prisma.mailDeliveryProtectionAlert.findMany({
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true, reason: true, transitionAt: true },
    })
    expect(alerts).toEqual([
      {
        occurredAt: scenarioTime(1),
        reason: 'delivery_circuit_open',
        transitionAt: scenarioTime(60_001),
      },
      {
        occurredAt: scenarioTime(3),
        reason: 'delivery_circuit_open',
        transitionAt: scenarioTime(60_003),
      },
    ])
    expect(Object.keys(alerts[1]!).sort()).toEqual(['occurredAt', 'reason', 'transitionAt'])
    expect(JSON.stringify(alerts)).not.toContain(request.recipient)
    expect(JSON.stringify(alerts)).not.toContain(request.messageId)
  })

  test('serializes the delivery-budget edge and emits one safe alert per expired window', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['90', '91', '92']) {
      await enqueuer.enqueue({ ...request, messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}` })
    }
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 10,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 1,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const workerIds = ['worker-edge-a', 'worker-edge-b']
    const firstWindow = await Promise.all(workerIds.map((workerId) => repository.claim({
      now: scenarioTime(),
      workerId,
    })))

    expect(firstWindow.filter((claim) => claim.kind === 'claimed')).toHaveLength(1)
    expect(firstWindow.filter((claim) => claim.kind === 'budget_exhausted')).toHaveLength(1)
    const firstAlert = firstWindow.flatMap((claim) =>
      claim.kind === 'budget_exhausted' && claim.protectionAlert
        ? [claim.protectionAlert]
        : [])
    expect(firstAlert).toEqual([{
      occurredAt: scenarioTime(),
      reason: 'delivery_budget_exhausted',
    }])
    expect(Object.keys(firstAlert[0] as object).sort()).toEqual(['occurredAt', 'reason'])
    expect(JSON.stringify(firstAlert)).not.toContain(request.recipient)
    expect(JSON.stringify(firstAlert)).not.toContain(request.messageId)

    const claimedIndex = firstWindow.findIndex((claim) => claim.kind === 'claimed')
    const claimed = firstWindow[claimedIndex]
    if (claimed?.kind !== 'claimed') throw new Error('Expected one claimed message')
    await expect(repository.recordAccepted({
      id: claimed.message.id,
      now: scenarioTime(1),
      workerId: workerIds[claimedIndex]!,
    })).resolves.toBe(true)

    const secondWindow = await Promise.all(workerIds.map((workerId) => repository.claim({
      now: scenarioTime(60_000),
      workerId,
    })))
    expect(secondWindow.filter((claim) => claim.kind === 'claimed')).toHaveLength(1)
    expect(secondWindow.filter((claim) => claim.kind === 'budget_exhausted')).toHaveLength(1)
    expect(secondWindow.flatMap((claim) =>
      claim.kind === 'budget_exhausted' && claim.protectionAlert
        ? [claim.protectionAlert]
        : [])).toEqual([{
      occurredAt: scenarioTime(60_000),
      reason: 'delivery_budget_exhausted',
    }])
    await expect(repository.claim({
      now: scenarioTime(60_001),
      workerId: 'worker-edge-c',
    })).resolves.toEqual({ kind: 'budget_exhausted' })
    expect(await prisma.mailDeliveryProtectionAlert.findMany({
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true, reason: true, transitionAt: true },
    })).toEqual([
      {
        occurredAt: scenarioTime(),
        reason: 'delivery_budget_exhausted',
        transitionAt: scenarioTime(),
      },
      {
        occurredAt: scenarioTime(60_000),
        reason: 'delivery_budget_exhausted',
        transitionAt: scenarioTime(60_000),
      },
    ])
  })

  test('reclaims an unacknowledged protection alert after logging recovers', async () => {
    const now = scenarioTime()
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 1_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    })
    await prisma.mailDeliveryProtectionAlert.create({
      data: {
        occurredAt: now,
        reason: 'delivery_budget_exhausted',
        transitionAt: now,
      },
    })

    await expect(service.dispatchProtectionAlerts({
      deliver: () => {
        throw new Error('logging unavailable')
      },
      limit: 1,
      now,
      workerId: 'alert-worker-a',
    })).resolves.toEqual({ claimed: 1, delivered: 0, failed: 1, staleClaims: 0 })
    expect(await prisma.mailDeliveryProtectionAlert.findUniqueOrThrow({
      where: {
        reason_transitionAt: { reason: 'delivery_budget_exhausted', transitionAt: now },
      },
      select: { deliveredAt: true, leaseExpiresAt: true, leaseOwner: true },
    })).toEqual({
      deliveredAt: null,
      leaseExpiresAt: scenarioTime(1_000),
      leaseOwner: 'alert-worker-a',
    })

    await expect(service.dispatchProtectionAlerts({
      deliver: () => undefined,
      limit: 1,
      now: scenarioTime(999),
      workerId: 'alert-worker-b',
    })).resolves.toEqual({ claimed: 0, delivered: 0, failed: 0, staleClaims: 0 })

    const delivered: Array<{ occurredAt: Date; reason: string; transitionAt: Date }> = []
    await expect(service.dispatchProtectionAlerts({
      deliver: (alert) => {
        delivered.push(alert)
      },
      limit: 1,
      now: scenarioTime(1_001),
      workerId: 'alert-worker-b',
    })).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0, staleClaims: 0 })
    expect(delivered).toEqual([{
      occurredAt: now,
      reason: 'delivery_budget_exhausted',
      transitionAt: now,
    }])
    expect(await prisma.mailDeliveryProtectionAlert.findUniqueOrThrow({
      where: {
        reason_transitionAt: { reason: 'delivery_budget_exhausted', transitionAt: now },
      },
      select: { deliveredAt: true, leaseExpiresAt: true, leaseOwner: true },
    })).toEqual({
      deliveredAt: scenarioTime(1_001),
      leaseExpiresAt: null,
      leaseOwner: null,
    })

    await expect(service.dispatchProtectionAlerts({
      deliver: () => undefined,
      limit: 1,
      now: scenarioTime(2_001),
      workerId: 'alert-worker-c',
    })).resolves.toEqual({ claimed: 0, delivered: 0, failed: 0, staleClaims: 0 })
  })

  test('claims each protection alert once across workers and bounds every batch', async () => {
    const now = scenarioTime()
    await prisma.mailDeliveryProtectionAlert.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        occurredAt: scenarioTime(index),
        reason: index % 2 === 0 ? 'delivery_budget_exhausted' : 'delivery_circuit_open',
        transitionAt: scenarioTime(index),
      })),
    })
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 1_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })

    const concurrentClaims = await Promise.all([
      repository.claimProtectionAlerts({ limit: 2, now, workerId: 'alert-worker-a' }),
      repository.claimProtectionAlerts({ limit: 2, now, workerId: 'alert-worker-b' }),
    ])
    expect(concurrentClaims[0]).toHaveLength(2)
    expect(concurrentClaims[1]).toHaveLength(2)
    const claimedTransitions = concurrentClaims.flat().map((alert) => alert.transitionAt.toISOString())
    expect(new Set(claimedTransitions).size).toBe(4)

    const remaining = await repository.claimProtectionAlerts({
      limit: 2,
      now,
      workerId: 'alert-worker-c',
    })
    expect(remaining).toHaveLength(1)
    expect(new Set([...claimedTransitions, remaining[0]!.transitionAt.toISOString()]).size).toBe(5)
    expect(Object.keys(remaining[0]!).sort()).toEqual(['occurredAt', 'reason', 'transitionAt'])
  })

  test('removes acknowledged alert history after thirty days without dropping pending delivery', async () => {
    const now = scenarioTime()
    const retentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000)
    await prisma.mailDeliveryProtectionAlert.createMany({
      data: [
        {
          deliveredAt: new Date(retentionCutoff.getTime() - 1),
          occurredAt: new Date(retentionCutoff.getTime() - 1),
          reason: 'delivery_budget_exhausted',
          transitionAt: new Date(retentionCutoff.getTime() - 1),
        },
        {
          occurredAt: new Date(retentionCutoff.getTime() - 2),
          reason: 'delivery_circuit_open',
          transitionAt: new Date(retentionCutoff.getTime() - 2),
        },
        {
          deliveredAt: retentionCutoff,
          occurredAt: retentionCutoff,
          reason: 'delivery_circuit_open',
          transitionAt: retentionCutoff,
        },
      ],
    })
    const enqueuer = createEnqueuer()
    for (const suffix of ['93', '94']) {
      await enqueuer.enqueue({ ...request, messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}` })
    }
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 10,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 1,
      leaseMs: 30_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })

    await expect(repository.claim({ now, workerId: 'worker-retention-a' }))
      .resolves.toMatchObject({ kind: 'claimed' })
    await expect(repository.claim({ now, workerId: 'worker-retention-b' }))
      .resolves.toMatchObject({
        kind: 'budget_exhausted',
        protectionAlert: { occurredAt: now, reason: 'delivery_budget_exhausted' },
      })
    expect(await prisma.mailDeliveryProtectionAlert.findMany({
      orderBy: { occurredAt: 'asc' },
      select: { deliveredAt: true, occurredAt: true, reason: true },
    })).toEqual([
      {
        deliveredAt: null,
        occurredAt: new Date(retentionCutoff.getTime() - 2),
        reason: 'delivery_circuit_open',
      },
      { deliveredAt: retentionCutoff, occurredAt: retentionCutoff, reason: 'delivery_circuit_open' },
      { deliveredAt: null, occurredAt: now, reason: 'delivery_budget_exhausted' },
    ])
  })

  test('stops at the shared delivery budget and terminally records retry exhaustion', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['30', '31', '32']) {
      await enqueuer.enqueue({ ...request, messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}` })
    }
    const budgetRepository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 10,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 2,
      leaseMs: 30_000,
      maxAttempts: 2,
      retryBaseMs: 1_000,
    })
    const acceptedService = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository: budgetRepository,
    })
    await expect(acceptedService.drain({
      limit: 3,
      now: scenarioTime(),
      workerId: 'worker-a',
    })).resolves.toMatchObject({
      accepted: 2,
      budgetExhausted: true,
      protectionAlerts: [{
        occurredAt: scenarioTime(),
        reason: 'delivery_budget_exhausted',
      }],
    })

    await expect(acceptedService.drain({
      limit: 1,
      now: scenarioTime(60_000),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ accepted: 1 })

    await enqueuer.enqueue({ ...request, messageId: '019f8099-7e26-7760-ad08-66d1d66b2840' })
    const failingService = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: {
        send: async () => ({
          ambiguous: true,
          code: 'smtp_response_lost',
          kind: 'temporary_failure',
        }),
      },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository: budgetRepository,
    })
    await failingService.drain({
      limit: 1,
      now: scenarioTime(120_000),
      workerId: 'worker-a',
    })
    await expect(failingService.drain({
      limit: 1,
      now: scenarioTime(121_000),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ terminalFailures: 1 })
    expect(await prisma.mailOutboxMessage.findUnique({
      where: { messageId: '019f8099-7e26-7760-ad08-66d1d66b2840' },
      select: {
        attemptCount: true,
        lastFailureCode: true,
        recipient: true,
        state: true,
        templatePayload: true,
      },
    })).toEqual({
      attemptCount: 2,
      lastFailureCode: 'retry_exhausted',
      recipient: '[redacted]',
      state: 'terminal_failure',
      templatePayload: {},
    })
  })

  test('does not spend the SMTP delivery budget on policy-blocked mail', async () => {
    const enqueuer = createEnqueuer()
    const blockedMessageId = '019f8099-7e26-7760-ad08-66d1d66b2841'
    const recoveryMessageId = '019f8099-7e26-7760-ad08-66d1d66b2842'
    await enqueuer.enqueue({
      ...request,
      messageId: blockedMessageId,
      template: {
        addressRole: 'account',
        expiresAt: scenarioTime(15 * 60_000),
        kind: 'account_email_confirmation',
      },
    })
    await enqueuer.enqueue({
      ...request,
      messageId: recoveryMessageId,
      template: {
        expiresAt: scenarioTime(15 * 60_000),
        kind: 'password_recovery',
        recoveryUrl: 'https://anomaly-detector.ru/recover/password',
      },
    })
    const sent: RenderedTransactionalMail[] = []
    const policyChecks: Array<{ emailDomain: string; forceMxRefresh?: boolean }> = []
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: {
        send: async (message) => {
          sent.push(message)
          return { kind: 'accepted' }
        },
      },
      policy: {
        evaluate: async (emailDomain, options) => {
          policyChecks.push({ emailDomain, forceMxRefresh: options?.forceMxRefresh })
          return { acceptsNewAddress: false, allowsRecoveryDelivery: true }
        },
      },
      repository: createPrismaMailOutboxRepository(prisma, {
        circuitFailureThreshold: 10,
        circuitOpenMs: 60_000,
        deliveryBudgetPerMinute: 1,
        leaseMs: 30_000,
        maxAttempts: 3,
        retryBaseMs: 1_000,
      }),
    })

    await expect(service.drain({
      limit: 2,
      now: scenarioTime(),
      workerId: 'worker-policy-budget',
    })).resolves.toMatchObject({
      accepted: 1,
      blocked: 1,
      budgetExhausted: false,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.messageId).toBe(`<${recoveryMessageId}@anomaly-detector.ru>`)
    expect(policyChecks).toEqual([
      { emailDomain: 'yandex.ru', forceMxRefresh: true },
      { emailDomain: 'yandex.ru', forceMxRefresh: true },
    ])
    expect(await prisma.mailDeliveryControl.findUniqueOrThrow({
      where: { id: 'reg_ru' },
      select: { deliveriesInWindow: true },
    })).toEqual({ deliveriesInWindow: 1 })
  })

  test('does not refund a policy-blocked reservation into a newer delivery window', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['43', '44']) {
      await enqueuer.enqueue({
        ...request,
        messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}`,
      })
    }
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 10,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 1,
      leaseMs: 120_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const firstWindowClaim = await repository.claim({
      now: scenarioTime(),
      workerId: 'worker-window-old',
    })
    expect(firstWindowClaim.kind).toBe('claimed')
    if (firstWindowClaim.kind !== 'claimed') throw new Error('Expected a claimed message')
    const secondWindowAt = scenarioTime(60_000)
    await expect(repository.claim({
      now: secondWindowAt,
      workerId: 'worker-window-new',
    })).resolves.toMatchObject({ kind: 'claimed' })

    await expect(repository.releaseBlocked({
      deliveryBudgetWindowStartedAt:
        firstWindowClaim.message.deliveryBudgetWindowStartedAt,
      id: firstWindowClaim.message.id,
      now: secondWindowAt,
      workerId: 'worker-window-old',
    })).resolves.toBe(true)
    expect(await prisma.mailDeliveryControl.findUniqueOrThrow({
      where: { id: 'reg_ru' },
      select: { deliveriesInWindow: true, windowStartedAt: true },
    })).toEqual({ deliveriesInWindow: 1, windowStartedAt: secondWindowAt })
  })

  test('leases one message to one worker and recovers an expired worker lease', async () => {
    const enqueuer = createEnqueuer()
    await enqueuer.enqueue({ ...request, messageId: '019f8099-7e26-7760-ad08-66d1d66b2850' })
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 1_000,
      maxAttempts: 3,
      retryBaseMs: 1_000,
    })
    const claims = await Promise.all([
      repository.claim({ now: scenarioTime(), workerId: 'worker-a' }),
      repository.claim({ now: scenarioTime(), workerId: 'worker-b' }),
    ])
    expect(claims.filter((claim) => claim.kind === 'claimed')).toHaveLength(1)

    const restartedService = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    })
    await expect(restartedService.drain({
      limit: 1,
      now: scenarioTime(1_001),
      workerId: 'worker-c',
    })).resolves.toMatchObject({ accepted: 1 })
    expect(await prisma.mailDeliveryAttempt.findMany({
      orderBy: { attemptedAt: 'asc' },
      select: { failureCode: true, outcome: true },
    })).toEqual([
      { failureCode: 'worker_lease_expired', outcome: 'temporary_failure' },
      { failureCode: null, outcome: 'smtp_accepted' },
    ])

    await enqueuer.enqueue({ ...request, messageId: '019f8099-7e26-7760-ad08-66d1d66b2851' })
    const exhaustingRepository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 1_000,
      maxAttempts: 1,
      retryBaseMs: 1_000,
    })
    await exhaustingRepository.claim({
      now: scenarioTime(60_000),
      workerId: 'worker-d',
    })
    await expect(exhaustingRepository.claim({
      now: scenarioTime(61_001),
      workerId: 'worker-e',
    })).resolves.toEqual({ kind: 'empty' })
    expect(await prisma.mailOutboxMessage.findUnique({
      where: { messageId: '019f8099-7e26-7760-ad08-66d1d66b2851' },
      select: { recipient: true, state: true, templatePayload: true },
    })).toEqual({ recipient: '[redacted]', state: 'terminal_failure', templatePayload: {} })
  })

  test('blocks new Account Email delivery while preserving recovery for a deprecated service', async () => {
    const enqueuer = createEnqueuer()
    await enqueuer.enqueue({ ...request, messageId: '019f8099-7e26-7760-ad08-66d1d66b2860' })
    await enqueuer.enqueue({
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2861',
      recipient: request.recipient,
      template: {
        addressRole: 'recovery',
        expiresAt: scenarioTime(15 * 60_000),
        kind: 'account_email_confirmation',
        recoveryPurpose: 'replacement_old',
      },
    })
    await enqueuer.enqueue({
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2862',
      recipient: request.recipient,
      template: {
        expiresAt: scenarioTime(15 * 60_000),
        kind: 'password_recovery',
        recoveryUrl: 'https://anomaly-detector.ru/recover/password',
      },
    })
    expect(await prisma.mailOutboxMessage.findUniqueOrThrow({
      where: { messageId: '019f8099-7e26-7760-ad08-66d1d66b2862' },
      select: { templatePayload: true },
    })).toEqual({
      templatePayload: {
        expiresAt: scenarioTime(15 * 60_000).toISOString(),
        kind: 'password_recovery',
        recoveryUrl: 'https://anomaly-detector.ru/recover/password',
      },
    })
    const providerMessages: RenderedTransactionalMail[] = []
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: {
        send: async (message) => {
          providerMessages.push(message)
          return { kind: 'accepted' }
        },
      },
      policy: {
        evaluate: async () => ({
          acceptsNewAddress: false,
          allowsRecoveryDelivery: true,
        }),
      },
      repository: createPrismaMailOutboxRepository(prisma, {
        circuitFailureThreshold: 3,
        circuitOpenMs: 60_000,
        deliveryBudgetPerMinute: 20,
        leaseMs: 30_000,
        maxAttempts: 3,
        retryBaseMs: 1_000,
      }),
    })

    await expect(service.drain({
      limit: 1,
      now: scenarioTime(),
      workerId: 'worker-a',
    })).resolves.toMatchObject({ blocked: 1 })
    expect(providerMessages).toHaveLength(0)
    expect(await prisma.mailOutboxMessage.findUnique({
      where: { messageId: '019f8099-7e26-7760-ad08-66d1d66b2860' },
      select: { attemptCount: true, lastFailureCode: true, state: true },
    })).toEqual({ attemptCount: 0, lastFailureCode: 'mail_service_blocked', state: 'queued' })
    expect(await prisma.mailDeliveryAttempt.count()).toBe(0)

    await expect(service.drain({
      limit: 2,
      now: scenarioTime(1),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ accepted: 2 })
    expect(providerMessages).toHaveLength(2)
    expect(providerMessages[0].subject).toBe(
      'Подтверждение старой почты восстановления — Anomaly Detector',
    )
    expect(providerMessages[0].text).toContain('Код для старой почты восстановления')
    expect(providerMessages[1].text).toContain(
      `https://anomaly-detector.ru/recover/password#token=${derivePasswordResetToken(
        confirmationCodeSecret,
        '019f8099-7e26-7760-ad08-66d1d66b2862',
      )}`,
    )
  })

  test('suppresses small provider groups from the operator delivery projection', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['70', '71', '72', '73']) {
      await enqueuer.enqueue({
        ...request,
        messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}`,
        recipient: 'researcher@outbox-test.invalid',
      })
    }
    const reader = createPrismaMailDeliveryOverviewReader(prisma, {
      configured: false,
      deliveryBudgetPerMinute: 60,
    })
    let view = await reader.read(scenarioTime())
    expect(view).toMatchObject({
      circuit: { state: 'disabled' },
      groups: [],
      totals: { requested: 4 },
    })
    expect(JSON.stringify(view)).not.toContain('researcher@outbox-test.invalid')

    await enqueuer.enqueue({
      ...request,
      messageId: '019f8099-7e26-7760-ad08-66d1d66b2874',
      recipient: 'researcher@outbox-test.invalid',
    })
    view = await reader.read(scenarioTime())
    expect(view.groups).toEqual([{
      providerId: 'other',
      requested: 5,
      smtpAccepted: 0,
      templateKind: 'account_email_confirmation',
      temporaryFailures: 0,
      terminalFailures: 0,
    }])
  })

  test('keeps the provider attribution captured by the delivery worker after MX assessment changes', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['75', '76', '77', '78', '79']) {
      await enqueuer.enqueue({
        ...request,
        messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}`,
        recipient: 'owner@outbox-attribution.ru',
      })
    }
    const service = new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: {
        evaluate: async () => ({
          acceptsNewAddress: true,
          allowsRecoveryDelivery: true,
          providerId: 'reg_ru',
        }),
      },
      repository: createPrismaMailOutboxRepository(prisma, {
        circuitFailureThreshold: 3,
        circuitOpenMs: 60_000,
        deliveryBudgetPerMinute: 20,
        leaseMs: 30_000,
        maxAttempts: 3,
        retryBaseMs: 1_000,
      }),
    })

    await expect(service.drain({
      limit: 5,
      now: scenarioTime(),
      workerId: 'worker-provider-attribution',
    })).resolves.toMatchObject({ accepted: 5 })

    await prisma.mailDomainAssessment.create({
      data: {
        catalogVersion: 1,
        checkedAt: scenarioTime(1),
        emailDomain: 'outbox-attribution.ru',
        expiresAt: scenarioTime(5 * 60_000),
        outcome: 'allowed',
        providerId: 'yandex',
      },
    })
    await prisma.mailDomainAssessment.delete({
      where: { emailDomain: 'outbox-attribution.ru' },
    })

    const stored = await prisma.$queryRaw<Array<{ policy_provider_id: string | null }>>`
      SELECT policy_provider_id
      FROM mail_outbox_messages
      WHERE recipient_domain = 'outbox-attribution.ru'
      ORDER BY message_id
    `
    expect(stored).toEqual(Array.from({ length: 5 }, () => ({
      policy_provider_id: 'reg_ru',
    })))

    const reader = createPrismaMailDeliveryOverviewReader(prisma, {
      configured: true,
      deliveryBudgetPerMinute: 60,
    })
    expect((await reader.read(scenarioTime())).groups).toContainEqual({
      providerId: 'reg_ru',
      requested: 5,
      smtpAccepted: 5,
      templateKind: 'account_email_confirmation',
      temporaryFailures: 0,
      terminalFailures: 0,
    })
  })

  test('cleanup removes only terminal outbox records after retention', async () => {
    const enqueuer = createEnqueuer()
    for (const suffix of ['80', '81', '82']) {
      await enqueuer.enqueue({ ...request, messageId: `019f8099-7e26-7760-ad08-66d1d66b28${suffix}` })
    }
    const repository = createPrismaMailOutboxRepository(prisma, {
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
      deliveryBudgetPerMinute: 20,
      leaseMs: 30_000,
      maxAttempts: 1,
      retryBaseMs: 1_000,
    })
    const now = scenarioTime()
    await new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    }).drain({ limit: 1, now, workerId: 'worker-a' })
    await new TransactionalMailDeliveryService({
      confirmationCodeSecret,
      delivery: { send: async () => ({ code: 'smtp_recipient_rejected', kind: 'terminal_failure' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    }).drain({ limit: 1, now, workerId: 'worker-b' })

    expect(await cleanupTerminalMailOutbox(
      prisma,
      scenarioTime(1),
    )).toEqual({ count: 2 })
    expect(await prisma.mailOutboxMessage.findMany({ select: { state: true } }))
      .toEqual([{ state: 'queued' }])
    expect(await prisma.mailDeliveryAttempt.count()).toBe(0)
  })
})
