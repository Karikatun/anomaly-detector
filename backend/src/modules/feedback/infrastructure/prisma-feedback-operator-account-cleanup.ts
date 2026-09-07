import type { DbTransaction } from '../../../db'

export async function anonymizePrismaFeedbackOperatorActorBatch(
  transaction: DbTransaction,
  input: {
    limit: number
    pseudonymousActorId: string
    userId: string
  },
) {
  const commandIds = await transaction.feedbackOperatorCommand.findMany({
    where: { actorId: input.userId },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: input.limit,
  })
  const commands = await transaction.feedbackOperatorCommand.updateMany({
    where: {
      actorId: input.userId,
      id: { in: commandIds.map(({ id }) => id) },
    },
    data: { actorId: input.pseudonymousActorId },
  })

  const auditIds = await transaction.feedbackAuditEvent.findMany({
    where: { actorId: input.userId },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: input.limit,
  })
  const audits = await transaction.feedbackAuditEvent.updateMany({
    where: {
      actorId: input.userId,
      id: { in: auditIds.map(({ id }) => id) },
    },
    data: { actorId: input.pseudonymousActorId },
  })

  const rawActorReferences = [
    await transaction.feedbackOperatorCommand.findFirst({
      where: { actorId: input.userId },
      select: { id: true },
    }),
    await transaction.feedbackAuditEvent.findFirst({
      where: { actorId: input.userId },
      select: { id: true },
    }),
  ]

  return {
    anonymizedRows: commands.count + audits.count,
    hasMore: rawActorReferences.some((reference) => reference !== null),
  }
}
