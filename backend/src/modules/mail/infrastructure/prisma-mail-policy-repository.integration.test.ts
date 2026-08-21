import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../../db'
import { MailPolicyService } from '../application/mail-policy-service'
import { MailPolicyFailure } from '../domain/errors'
import { createPrismaMailPolicyRepository } from './prisma-mail-policy-repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Prisma mail policy repository', () => {
  if (!databaseUrl) return

  const prisma = createPrisma(databaseUrl)
  const repository = createPrismaMailPolicyRepository(prisma)
  const actorId = '019f8099-7e26-7760-ad08-66d1d66b2718'

  beforeEach(async () => {
    await prisma.mailPolicyAuditEvent.deleteMany()
    await prisma.mailPolicyCommand.deleteMany()
    await prisma.mailPolicyEntry.deleteMany()
    await prisma.mailPolicyVersion.deleteMany()
    await prisma.mailRegistryCandidate.deleteMany()
    await prisma.mailRegistryImport.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('imports reviewed candidates and publishes an immutable first policy version', async () => {
    const imported = await repository.commitImport({
      actorId,
      candidates: [{
        evidence: 'service_description_mentions_mail',
        registryEntryId: '1-PP',
        serviceDomain: 'mail.yandex.ru',
      }],
      checksum: 'a'.repeat(64),
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2719',
      expectedVersion: 0,
      fingerprint: 'b'.repeat(64),
      sourceDate: '2026-08-20',
      sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
    })
    expect(imported).toMatchObject({ kind: 'committed', receipt: { kind: 'import_succeeded' } })

    const afterImport = await repository.readView(new Date('2026-08-22T12:00:00.000Z'))
    const candidate = afterImport.lastSuccessfulImport?.candidates[0]
    expect(afterImport).toMatchObject({
      currentVersion: 0,
      lastSuccessfulImport: {
        diff: { added: ['mail.yandex.ru'], removed: [], unchangedCount: 0 },
      },
      publishedPolicy: null,
    })
    expect(candidate).toBeDefined()

    const published = await repository.publish({
      actorId,
      additions: [{
        canonicalization: {
          ignoreDots: false,
          localPartCaseInsensitive: true,
          stripPlusTag: false,
        },
        emailDomain: 'yandex.ru',
        sourceCandidateId: candidate!.id,
      }],
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      expectedVersion: 0,
      fingerprint: 'c'.repeat(64),
    })
    expect(published).toEqual({ kind: 'committed', receipt: { kind: 'policy_published', version: 1 } })
    await expect(repository.evaluate('yandex.ru')).resolves.toEqual({
      acceptsNewAddress: true,
      allowsRecoveryDelivery: true,
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: true,
        stripPlusTag: false,
      },
      state: 'approved',
      version: 1,
    })

    const view = await repository.readView(new Date('2026-08-22T12:00:00.000Z'))
    expect(view).toMatchObject({
      currentVersion: 1,
      publishedPolicy: {
        entries: [{ emailDomain: 'yandex.ru', reason: null, state: 'approved' }],
        version: 1,
      },
    })
    expect(await prisma.mailPolicyAuditEvent.count()).toBe(2)
    expect(await prisma.mailPolicyCommand.count()).toBe(2)
  })

  test('serializes concurrent publication, replays one command, and applies status semantics', async () => {
    let sourceCalls = 0
    const service = new MailPolicyService({
      clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
      repository,
      source: {
        load: async () => {
          sourceCalls += 1
          return {
            candidates: [{
              evidence: 'service_description_mentions_mail' as const,
              registryEntryId: '1-PP',
              serviceDomain: 'mail.yandex.ru',
            }],
            checksum: 'd'.repeat(64),
            sourceDate: '2026-08-20',
            sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
          }
        },
      },
    })
    const operator = {
      authenticatedAt: new Date('2026-08-22T11:55:00.000Z'),
      id: actorId,
    }
    const importCommand = {
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2721',
      expectedVersion: 0,
    }
    await service.importCandidates(importCommand, operator)
    await service.importCandidates(importCommand, operator)
    expect(sourceCalls).toBe(1)
    const candidateId = (await service.read()).lastSuccessfulImport!.candidates[0].id
    const canonicalization = {
      ignoreDots: false,
      localPartCaseInsensitive: false,
      stripPlusTag: false,
    }
    const publishYandex = {
      additions: [{ canonicalization, emailDomain: 'yandex.ru', sourceCandidateId: candidateId }],
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2722',
      expectedVersion: 0,
    }
    const publishYa = {
      additions: [{ canonicalization, emailDomain: 'ya.ru', sourceCandidateId: candidateId }],
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2723',
      expectedVersion: 0,
    }
    const results = await Promise.allSettled([
      service.publish(publishYandex, operator),
      service.publish(publishYa, operator),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { kind: 'version_conflict' },
    })

    const successfulCommand = results[0].status === 'fulfilled' ? publishYandex : publishYa
    const publishedDomain = successfulCommand.additions[0].emailDomain
    await service.publish(successfulCommand, operator)
    expect((await service.read()).currentVersion).toBe(1)
    await expect(service.publish({
      ...successfulCommand,
      additions: [{ ...successfulCommand.additions[0], emailDomain: 'other.ru' }],
    }, operator)).rejects.toMatchObject({ kind: 'command_conflict' } satisfies Partial<MailPolicyFailure>)

    await service.changeStatus({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2724',
      emailDomain: publishedDomain,
      expectedVersion: 1,
      reason: 'Новые привязки остановлены оператором',
      state: 'deprecated',
    }, operator)
    await expect(service.evaluate(publishedDomain)).resolves.toMatchObject({
      acceptsNewAddress: false,
      allowsRecoveryDelivery: true,
      state: 'deprecated',
      version: 2,
    })
    await service.changeStatus({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2725',
      emailDomain: publishedDomain,
      expectedVersion: 2,
      reason: 'Подтверждённый security-инцидент',
      state: 'blocked',
    }, operator)
    await expect(service.evaluate(publishedDomain)).resolves.toMatchObject({
      acceptsNewAddress: false,
      allowsRecoveryDelivery: false,
      state: 'blocked',
      version: 3,
    })
    expect(await prisma.mailPolicyAuditEvent.count()).toBe(4)
  })

  test('records failed and suspicious imports while preserving the last-known-good policy', async () => {
    const baselineCandidates = Array.from({ length: 10 }, (_, index) => ({
      evidence: 'service_description_mentions_mail' as const,
      registryEntryId: `${index + 1}-PP`,
      serviceDomain: `mail${index}.example.ru`,
    }))
    await repository.commitImport({
      actorId,
      candidates: baselineCandidates,
      checksum: 'e'.repeat(64),
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2730',
      expectedVersion: 0,
      fingerprint: 'f'.repeat(64),
      sourceDate: '2026-08-20',
      sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
    })
    const baseline = await repository.readView(new Date('2026-08-22T12:00:00.000Z'))
    await repository.publish({
      actorId,
      additions: [{
        canonicalization: {
          ignoreDots: false,
          localPartCaseInsensitive: false,
          stripPlusTag: false,
        },
        emailDomain: 'example.ru',
        sourceCandidateId: baseline.lastSuccessfulImport!.candidates[0].id,
      }],
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2731',
      expectedVersion: 0,
      fingerprint: '1'.repeat(64),
    })

    let sourceMode: 'removal' | 'failure' = 'removal'
    const service = new MailPolicyService({
      clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
      repository,
      source: {
        load: async () => {
          if (sourceMode === 'failure') throw Object.assign(new Error('source down'), { code: 'source_unavailable' })
          return {
            candidates: baselineCandidates.slice(0, 5),
            checksum: '2'.repeat(64),
            sourceDate: '2026-08-21',
            sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data-next.xml',
          }
        },
      },
    })
    const operator = {
      authenticatedAt: new Date('2026-08-22T11:55:00.000Z'),
      id: actorId,
    }
    await expect(service.importCandidates({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2732',
      expectedVersion: 1,
    }, operator)).rejects.toMatchObject({ kind: 'suspicious_mass_removal' })
    let view = await service.read()
    expect(view).toMatchObject({
      currentVersion: 1,
      latestAttempt: { failureCode: 'suspicious_mass_removal', outcome: 'rejected' },
      publishedPolicy: { version: 1 },
    })
    expect(view.lastSuccessfulImport?.candidates).toHaveLength(10)

    sourceMode = 'failure'
    await expect(service.importCandidates({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2733',
      expectedVersion: 1,
    }, operator)).rejects.toMatchObject({ kind: 'source_import_failed' })
    view = await service.read()
    expect(view).toMatchObject({
      currentVersion: 1,
      latestAttempt: { failureCode: 'source_unavailable', outcome: 'failed' },
      publishedPolicy: { version: 1 },
    })
    expect(view.lastSuccessfulImport?.candidates).toHaveLength(10)
  })

  test('rejects a publication beyond the bounded policy projection without advancing the version', async () => {
    const candidates = Array.from({ length: 101 }, (_, index) => ({
      evidence: 'service_description_mentions_mail' as const,
      registryEntryId: `${index + 1}-PP`,
      serviceDomain: `mail${index}.example.ru`,
    }))
    await repository.commitImport({
      actorId,
      candidates,
      checksum: '3'.repeat(64),
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2740',
      expectedVersion: 0,
      fingerprint: '4'.repeat(64),
      sourceDate: '2026-08-22',
      sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
    })
    const imported = await repository.readView(new Date('2026-08-22T12:00:00.000Z'))
    const canonicalization = {
      ignoreDots: false,
      localPartCaseInsensitive: false,
      stripPlusTag: false,
    }
    const initial = await repository.publish({
      actorId,
      additions: imported.lastSuccessfulImport!.candidates.slice(0, 100).map((candidate, index) => ({
        canonicalization,
        emailDomain: `approved${index}.example.ru`,
        sourceCandidateId: candidate.id,
      })),
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2741',
      expectedVersion: 0,
      fingerprint: '5'.repeat(64),
    })
    expect(initial).toMatchObject({ kind: 'committed', receipt: { version: 1 } })

    const overflow = await repository.publish({
      actorId,
      additions: [{
        canonicalization,
        emailDomain: 'overflow.example.ru',
        sourceCandidateId: imported.lastSuccessfulImport!.candidates[100].id,
      }],
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2742',
      expectedVersion: 1,
      fingerprint: '6'.repeat(64),
    })

    expect(overflow).toEqual({ kind: 'policy_limit_exceeded' })
    expect((await repository.readView(new Date('2026-08-22T12:00:00.000Z'))).currentVersion).toBe(1)
  })
})
