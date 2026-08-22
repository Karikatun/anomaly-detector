import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { createTransactionalMailRequester } from '..'
import { TransactionalMailDeliveryService } from '../application/transactional-mail-delivery-service'
import { TransactionalMailService } from '../application/transactional-mail-service'
import type { RenderedTransactionalMail } from '../application/transactional-mail-ports'
import {
  createPrismaMailOutboxRepository,
  createPrismaTransactionalMailWriter,
} from './prisma-transactional-mail-outbox'
import { createPrismaMailDeliveryOverviewReader } from './prisma-mail-delivery-overview-reader'
import { cleanupTerminalMailOutbox } from './prisma-mail-outbox-cleanup'

const databaseUrl = process.env.TEST_DATABASE_URL
const fingerprintKey = 'integration-mail-fingerprint-key-0001'
const maybeDescribe = databaseUrl ? describe : describe.skip

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
      code: '482193',
      expiresAt: new Date('2026-08-22T12:15:00.000Z'),
      kind: 'account_email_confirmation' as const,
    },
  }

  beforeEach(async () => {
    await prisma.mailDeliveryAttempt.deleteMany()
    await prisma.mailOutboxMessage.deleteMany()
    await prisma.mailDeliveryControl.deleteMany()
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
      now: new Date('2026-08-22T12:00:00.000Z'),
      workerId: 'worker-a',
    })).resolves.toMatchObject({ temporaryFailures: 1 })

    const restartedRuntime = new TransactionalMailDeliveryService(dependencies)
    await expect(restartedRuntime.drain({
      limit: 1,
      now: new Date('2026-08-22T12:00:01.000Z'),
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

  test('opens one global circuit after provider failures and permits one recovery probe', async () => {
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
      now: new Date('2026-08-22T12:00:00.000Z'),
      workerId: 'worker-a',
    })).resolves.toMatchObject({ circuitOpen: true, temporaryFailures: 2 })
    expect(providerCalls).toBe(2)

    providerAvailable = true
    await expect(service.drain({
      limit: 1,
      now: new Date('2026-08-22T12:01:00.000Z'),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ accepted: 1, circuitOpen: false })
    expect(await prisma.mailDeliveryControl.findUnique({
      where: { id: 'reg_ru' },
      select: { circuitOpenUntil: true, consecutiveFailures: true },
    })).toEqual({ circuitOpenUntil: null, consecutiveFailures: 0 })
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
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository: budgetRepository,
    })
    await expect(acceptedService.drain({
      limit: 3,
      now: new Date('2026-08-22T12:00:00.000Z'),
      workerId: 'worker-a',
    })).resolves.toMatchObject({ accepted: 2, budgetExhausted: true })

    await expect(acceptedService.drain({
      limit: 1,
      now: new Date('2026-08-22T12:01:00.000Z'),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ accepted: 1 })

    await enqueuer.enqueue({ ...request, messageId: '019f8099-7e26-7760-ad08-66d1d66b2840' })
    const failingService = new TransactionalMailDeliveryService({
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
      now: new Date('2026-08-22T12:02:00.000Z'),
      workerId: 'worker-a',
    })
    await expect(failingService.drain({
      limit: 1,
      now: new Date('2026-08-22T12:02:01.000Z'),
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
      repository.claim({ now: new Date('2026-08-22T12:00:00.000Z'), workerId: 'worker-a' }),
      repository.claim({ now: new Date('2026-08-22T12:00:00.000Z'), workerId: 'worker-b' }),
    ])
    expect(claims.filter((claim) => claim.kind === 'claimed')).toHaveLength(1)

    const restartedService = new TransactionalMailDeliveryService({
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    })
    await expect(restartedService.drain({
      limit: 1,
      now: new Date('2026-08-22T12:00:01.001Z'),
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
      now: new Date('2026-08-22T12:01:00.000Z'),
      workerId: 'worker-d',
    })
    await expect(exhaustingRepository.claim({
      now: new Date('2026-08-22T12:01:01.001Z'),
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
        expiresAt: new Date('2026-08-22T12:15:00.000Z'),
        kind: 'password_recovery',
        recoveryUrl: 'https://anomaly-detector.ru/recover/opaque-token',
      },
    })
    let providerCalls = 0
    const service = new TransactionalMailDeliveryService({
      delivery: {
        send: async () => {
          providerCalls += 1
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
      now: new Date('2026-08-22T12:00:00.000Z'),
      workerId: 'worker-a',
    })).resolves.toMatchObject({ blocked: 1 })
    expect(providerCalls).toBe(0)
    expect(await prisma.mailOutboxMessage.findUnique({
      where: { messageId: '019f8099-7e26-7760-ad08-66d1d66b2860' },
      select: { attemptCount: true, lastFailureCode: true, state: true },
    })).toEqual({ attemptCount: 0, lastFailureCode: 'mail_service_blocked', state: 'queued' })
    expect(await prisma.mailDeliveryAttempt.count()).toBe(0)

    await expect(service.drain({
      limit: 1,
      now: new Date('2026-08-22T12:00:00.001Z'),
      workerId: 'worker-b',
    })).resolves.toMatchObject({ accepted: 1 })
    expect(providerCalls).toBe(1)
  })

  test('suppresses small service groups from the operator delivery projection', async () => {
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
    let view = await reader.read(new Date('2026-08-22T12:00:00.000Z'))
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
    view = await reader.read(new Date('2026-08-22T12:00:00.000Z'))
    expect(view.groups).toEqual([{
      requested: 5,
      service: 'other',
      smtpAccepted: 0,
      templateKind: 'account_email_confirmation',
      temporaryFailures: 0,
      terminalFailures: 0,
    }])
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
    const now = new Date('2026-08-22T12:00:00.000Z')
    await new TransactionalMailDeliveryService({
      delivery: { send: async () => ({ kind: 'accepted' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    }).drain({ limit: 1, now, workerId: 'worker-a' })
    await new TransactionalMailDeliveryService({
      delivery: { send: async () => ({ code: 'smtp_recipient_rejected', kind: 'terminal_failure' }) },
      policy: { evaluate: async () => ({ acceptsNewAddress: true, allowsRecoveryDelivery: true }) },
      repository,
    }).drain({ limit: 1, now, workerId: 'worker-b' })

    expect(await cleanupTerminalMailOutbox(
      prisma,
      new Date('2026-08-22T12:00:00.001Z'),
    )).toEqual({ count: 2 })
    expect(await prisma.mailOutboxMessage.findMany({ select: { state: true } }))
      .toEqual([{ state: 'queued' }])
    expect(await prisma.mailDeliveryAttempt.count()).toBe(0)
  })
})
