import type { DbTransaction } from '../../../db'

export async function anonymizePrismaMailOperatorActorBatch(
  transaction: DbTransaction,
  input: {
    limit: number
    pseudonymousActorId: string
    userId: string
  },
) {
  const policyVersionIds = await transaction.mailPolicyVersion.findMany({
    where: { publishedBy: input.userId },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: input.limit,
  })
  const policyVersions = await transaction.mailPolicyVersion.updateMany({
    where: {
      id: { in: policyVersionIds.map(({ id }) => id) },
      publishedBy: input.userId,
    },
    data: { publishedBy: input.pseudonymousActorId },
  })

  const commandIds = await transaction.mailPolicyCommand.findMany({
    where: { actorId: input.userId },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: input.limit,
  })
  const commands = await transaction.mailPolicyCommand.updateMany({
    where: {
      actorId: input.userId,
      id: { in: commandIds.map(({ id }) => id) },
    },
    data: { actorId: input.pseudonymousActorId },
  })

  const auditIds = await transaction.mailPolicyAuditEvent.findMany({
    where: { actorId: input.userId },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: input.limit,
  })
  const audits = await transaction.mailPolicyAuditEvent.updateMany({
    where: {
      actorId: input.userId,
      id: { in: auditIds.map(({ id }) => id) },
    },
    data: { actorId: input.pseudonymousActorId },
  })

  const rawActorReferences = [
    await transaction.mailPolicyVersion.findFirst({
      where: { publishedBy: input.userId },
      select: { id: true },
    }),
    await transaction.mailPolicyCommand.findFirst({
      where: { actorId: input.userId },
      select: { id: true },
    }),
    await transaction.mailPolicyAuditEvent.findFirst({
      where: { actorId: input.userId },
      select: { id: true },
    }),
  ]

  return {
    anonymizedRows: policyVersions.count + commands.count + audits.count,
    hasMore: rawActorReferences.some((reference) => reference !== null),
  }
}
