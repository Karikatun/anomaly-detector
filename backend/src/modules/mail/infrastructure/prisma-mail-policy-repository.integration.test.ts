import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { APPROVED_MAIL_PROVIDER_CATALOG } from '../application/approved-mail-provider-catalog'
import { MailPolicyService } from '../application/mail-policy-service'
import { MailPolicyFailure } from '../domain/errors'
import { evaluateTransactionalAccountEmail } from './prisma-account-email-policy'
import {
  cleanupExpiredMailDomainAssessments,
  createPrismaMailPolicyRepository,
} from './prisma-mail-policy-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Prisma mail provider policy repository', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const repository = createPrismaMailPolicyRepository(prisma)
  const actorId = '019f8099-7e26-7760-ad08-66d1d66b2718'
  const now = new Date('2026-08-25T12:00:00.000Z')

  beforeEach(async () => {
    await prisma.mailDomainAssessment.deleteMany()
    await prisma.mailPolicyAuditEvent.deleteMany()
    await prisma.mailPolicyCommand.deleteMany()
    await prisma.mailPolicyEntry.deleteMany()
    await prisma.mailPolicyVersion.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('syncs the reviewed catalog as one immutable audited policy version', async () => {
    const synced = await repository.syncCatalog({
      actorId,
      catalog: APPROVED_MAIL_PROVIDER_CATALOG,
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2719',
      expectedVersion: 0,
      fingerprint: 'a'.repeat(64),
    })

    expect(synced).toEqual({ kind: 'committed', receipt: { kind: 'catalog_synced', version: 1 } })
    await expect(repository.evaluate('yandex.ru', now)).resolves.toMatchObject({
      acceptsNewAddress: true,
      allowsRecoveryDelivery: true,
      catalogVersion: 1,
      providerId: 'yandex',
      requiresMxAssessment: false,
      source: 'public_domain',
      state: 'approved',
      version: 1,
    })

    const view = await repository.readView(now, APPROVED_MAIL_PROVIDER_CATALOG)
    expect(view).toMatchObject({
      availableCatalog: {
        diff: { addedProviderIds: [], changedProviderIds: [], removedProviderIds: [] },
        version: 1,
      },
      currentVersion: 1,
      publishedPolicy: {
        catalogVersion: 1,
        version: 1,
      },
    })
    expect(view.publishedPolicy?.providers.map(({ providerId }) => providerId)).toEqual(
      APPROVED_MAIL_PROVIDER_CATALOG.providers.map(({ providerId }) => providerId),
    )
    expect(await prisma.mailPolicyAuditEvent.count()).toBe(1)
    expect(await prisma.mailPolicyCommand.count()).toBe(1)
  })

  test('uses only a fresh catalog-matched MX assessment for a custom domain', async () => {
    await syncFirstPolicy(repository, actorId)
    await expect(repository.evaluate('anomaly-detector.ru', now)).resolves.toMatchObject({
      acceptsNewAddress: false,
      catalogVersion: 1,
      requiresMxAssessment: true,
      state: 'unlisted',
    })

    await repository.storeAssessment({
      catalogVersion: 1,
      checkedAt: now,
      emailDomain: 'anomaly-detector.ru',
      expiresAt: new Date(now.getTime() + 60_000),
      failureCode: null,
      mxFingerprint: 'b'.repeat(64),
      outcome: 'allowed',
      providerId: 'reg_ru',
    })
    await expect(repository.evaluate('anomaly-detector.ru', now)).resolves.toMatchObject({
      acceptsNewAddress: true,
      allowsRecoveryDelivery: true,
      providerId: 'reg_ru',
      requiresMxAssessment: false,
      source: 'mx',
      state: 'approved',
    })
    await expect(prisma.$transaction((transaction) => evaluateTransactionalAccountEmail(
      transaction,
      'Owner@anomaly-detector.ru',
      now,
    ))).resolves.toMatchObject({
      acceptsNewAddress: true,
      canonicalKey: 'Owner@anomaly-detector.ru',
      policyVersion: 1,
      providerId: 'reg_ru',
    })

    const afterExpiry = new Date(now.getTime() + 60_001)
    await expect(repository.evaluate('anomaly-detector.ru', afterExpiry)).resolves.toMatchObject({
      acceptsNewAddress: false,
      requiresMxAssessment: true,
      state: 'unlisted',
    })
  })

  test('deletes expired domain assessments in bounded batches and preserves fresh rows', async () => {
    await prisma.mailDomainAssessment.createMany({
      data: [
        {
          catalogVersion: 1,
          checkedAt: new Date(now.getTime() - 120_000),
          emailDomain: 'oldest-private-domain.ru',
          expiresAt: new Date(now.getTime() - 60_000),
          outcome: 'denied',
        },
        {
          catalogVersion: 1,
          checkedAt: new Date(now.getTime() - 60_000),
          emailDomain: 'boundary-private-domain.ru',
          expiresAt: now,
          outcome: 'retry',
        },
        {
          catalogVersion: 1,
          checkedAt: now,
          emailDomain: 'fresh-private-domain.ru',
          expiresAt: new Date(now.getTime() + 60_000),
          outcome: 'allowed',
          providerId: 'reg_ru',
        },
      ],
    })

    await expect(cleanupExpiredMailDomainAssessments(prisma, now, { limit: 1 }))
      .resolves.toEqual({ count: 1 })
    expect(await prisma.mailDomainAssessment.findMany({
      orderBy: { emailDomain: 'asc' },
      select: { emailDomain: true },
    })).toEqual([
      { emailDomain: 'boundary-private-domain.ru' },
      { emailDomain: 'fresh-private-domain.ru' },
    ])

    await expect(cleanupExpiredMailDomainAssessments(prisma, now, { limit: 1 }))
      .resolves.toEqual({ count: 1 })
    await expect(cleanupExpiredMailDomainAssessments(prisma, now, { limit: 1 }))
      .resolves.toEqual({ count: 0 })
    expect(await prisma.mailDomainAssessment.findMany({
      select: { emailDomain: true },
    })).toEqual([{ emailDomain: 'fresh-private-domain.ru' }])
  })

  test('drains more than one expired assessment batch in one maintenance run', async () => {
    await prisma.mailDomainAssessment.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        catalogVersion: 1,
        checkedAt: new Date(now.getTime() - 120_000),
        emailDomain: `expired-${index}.private-domain.ru`,
        expiresAt: new Date(now.getTime() - 60_000),
        outcome: 'denied',
      })),
    })

    await expect(cleanupExpiredMailDomainAssessments(prisma, now))
      .resolves.toEqual({ count: 501 })
    expect(await prisma.mailDomainAssessment.count()).toBe(0)
  })

  test('replays one sync command and serializes provider status changes', async () => {
    const service = new MailPolicyService({
      clock: { now: () => now },
      mxResolver: { resolve: async () => ({ kind: 'no_mx' }) },
      repository,
    })
    const operator = {
      authenticatedAt: new Date(now.getTime() - 60_000),
      id: actorId,
    }
    const sync = {
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2721',
      expectedVersion: 0,
    }
    await service.syncCatalog(sync, operator)
    await service.syncCatalog(sync, operator)
    expect(await prisma.mailPolicyVersion.count()).toBe(1)

    const results = await Promise.allSettled([
      service.changeStatus({
        commandId: '019f8099-7e26-7760-ad08-66d1d66b2722',
        expectedVersion: 1,
        providerId: 'yandex',
        reason: 'Подтверждённый security-инцидент',
        state: 'blocked',
      }, operator),
      service.changeStatus({
        commandId: '019f8099-7e26-7760-ad08-66d1d66b2723',
        expectedVersion: 1,
        providerId: 'vk_mail',
        reason: 'Новые привязки временно остановлены',
        state: 'deprecated',
      }, operator),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { kind: 'version_conflict' },
    })
    expect(await prisma.mailPolicyVersion.count()).toBe(2)

    await expect(service.changeStatus({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2724',
      expectedVersion: 2,
      providerId: 'unknown',
      reason: 'Неизвестный провайдер',
      state: 'blocked',
    }, operator)).rejects.toMatchObject({ kind: 'provider_not_found' } satisfies Partial<MailPolicyFailure>)
  })

  test('preserves the latest blocked state across catalog removal and re-addition', async () => {
    await syncFirstPolicy(repository, actorId)
    await repository.changeStatus({
      actorId,
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
      fingerprint: '1'.repeat(64),
      providerId: 'reg_ru',
      reason: 'Новые адреса временно остановлены',
      state: 'deprecated',
    })
    await repository.changeStatus({
      actorId,
      commandId: crypto.randomUUID(),
      expectedVersion: 2,
      fingerprint: '2'.repeat(64),
      providerId: 'reg_ru',
      reason: 'Подтверждённый инцидент не снят',
      state: 'blocked',
    })
    await prisma.mailPolicyAuditEvent.updateMany({
      data: { occurredAt: new Date('2026-08-22T12:00:00.000Z') },
      where: { kind: 'mail_policy_provider_status_changed' },
    })
    const withoutRegRu = {
      providers: APPROVED_MAIL_PROVIDER_CATALOG.providers.filter(
        ({ providerId }) => providerId !== 'reg_ru',
      ),
      version: 2,
    }
    await repository.syncCatalog({
      actorId,
      catalog: withoutRegRu,
      commandId: crypto.randomUUID(),
      expectedVersion: 3,
      fingerprint: '3'.repeat(64),
    })
    await repository.syncCatalog({
      actorId,
      catalog: { ...APPROVED_MAIL_PROVIDER_CATALOG, version: 3 },
      commandId: crypto.randomUUID(),
      expectedVersion: 4,
      fingerprint: '4'.repeat(64),
    })
    await repository.storeAssessment({
      catalogVersion: 3,
      checkedAt: now,
      emailDomain: 'readded-provider.ru',
      expiresAt: new Date(now.getTime() + 60_000),
      failureCode: null,
      mxFingerprint: '4'.repeat(64),
      outcome: 'allowed',
      providerId: 'reg_ru',
    })

    await expect(repository.evaluate('readded-provider.ru', now)).resolves.toMatchObject({
      acceptsNewAddress: false,
      allowsRecoveryDelivery: false,
      providerId: 'reg_ru',
      state: 'blocked',
      version: 5,
    })
  })

  test('holds policy publication behind an owning account transaction', async () => {
    await syncFirstPolicy(repository, actorId)
    await repository.storeAssessment({
      catalogVersion: 1,
      checkedAt: now,
      emailDomain: 'company.ru',
      expiresAt: new Date(now.getTime() + 60_000),
      failureCode: null,
      mxFingerprint: 'c'.repeat(64),
      outcome: 'allowed',
      providerId: 'yandex',
    })

    let releaseOwnerTransaction!: () => void
    const ownerTransactionReleased = new Promise<void>((resolve) => { releaseOwnerTransaction = resolve })
    let ownerPolicyRead!: () => void
    const ownerPolicyReadPromise = new Promise<void>((resolve) => { ownerPolicyRead = resolve })
    const ownerTransaction = prisma.$transaction(async (transaction) => {
      const decision = await evaluateTransactionalAccountEmail(transaction, 'Player@company.ru', now)
      ownerPolicyRead()
      await ownerTransactionReleased
      return decision
    })
    await ownerPolicyReadPromise

    const statusChange = repository.changeStatus({
      actorId,
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2750',
      expectedVersion: 1,
      fingerprint: 'd'.repeat(64),
      providerId: 'yandex',
      reason: 'Новые привязки приостановлены',
      state: 'deprecated',
    })
    try {
      await waitForAdvisoryLockWaiter(prisma)
      expect(await prisma.mailPolicyVersion.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      })).toEqual({ version: 1 })
    } finally {
      releaseOwnerTransaction()
    }

    await expect(ownerTransaction).resolves.toMatchObject({
      acceptsNewAddress: true,
      policyVersion: 1,
      providerId: 'yandex',
    })
    await expect(statusChange).resolves.toEqual({
      kind: 'committed',
      receipt: { kind: 'status_changed', version: 2 },
    })
  })
})

async function syncFirstPolicy(
  repository: ReturnType<typeof createPrismaMailPolicyRepository>,
  actorId: string,
) {
  await repository.syncCatalog({
    actorId,
    catalog: APPROVED_MAIL_PROVIDER_CATALOG,
    commandId: crypto.randomUUID(),
    expectedVersion: 0,
    fingerprint: 'f'.repeat(64),
  })
}

async function waitForAdvisoryLockWaiter(prisma: ReturnType<typeof createPrisma>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [result] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT count(*)::bigint AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
    `
    if ((result?.waiting ?? 0n) > 0n) return
    await Bun.sleep(10)
  }
  throw new Error('Expected mail-policy publication to wait for the owning transaction')
}
