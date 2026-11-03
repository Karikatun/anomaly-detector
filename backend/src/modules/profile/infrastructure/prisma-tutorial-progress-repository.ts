import { tutorialLessonsProgressSchema, type TutorialLessonsProgress } from '@anomaly-detector/contracts'

import type { DbClient } from '../../../db'
import type { Prisma } from '../../../generated/prisma/client'
import { lockAccountLifecycleTransaction } from '../../../security/account-lifecycle-lock'
import type { TutorialProgressRepository } from '../application/ports'

export function createPrismaTutorialProgressRepository(
  db: DbClient,
  accountLifecycleSecret: string,
): TutorialProgressRepository {
  return {
    async read(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { tutorialCompletedAt: true },
      })
      return user?.tutorialCompletedAt ?? null
    },

    async complete(userId, completedAt) {
      return db.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, accountLifecycleSecret, userId)
        const user = await transaction.user.findFirst({
          where: { anonymizedAt: null, id: userId },
          select: { tutorialCompletedAt: true },
        })
        if (!user) return null
        if (user.tutorialCompletedAt) return user.tutorialCompletedAt
        await transaction.user.updateMany({
          where: { anonymizedAt: null, id: userId, tutorialCompletedAt: null },
          data: { tutorialCompletedAt: completedAt },
        })
        return completedAt
      })
    },

    async readLessons(userId) {
      return db.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, accountLifecycleSecret, userId)
        return readLessons(transaction, userId)
      })
    },

    async recordLesson(userId, command, completedAt) {
      return db.$transaction(async (transaction) => {
        await lockAccountLifecycleTransaction(transaction, accountLifecycleSecret, userId)
        const user = await transaction.user.findFirst({ where: { id: userId, anonymizedAt: null }, select: { id: true } })
        if (!user) return null
        // A duplicate never changes the first accepted date or another origin/version.
        await transaction.tutorialCompletionRecord.createMany({
          data: [{
            userId,
            lessonId: 'base',
            versionKey: command.kind === 'legacy-credit' ? 'legacy' : command.scenarioVersion,
            origin: command.kind === 'legacy-credit' ? 'legacy' : 'scenario',
            completedAt: command.kind === 'legacy-credit' ? null : completedAt,
          }],
          skipDuplicates: true,
        })
        return readLessons(transaction, userId)
      })
    },
  }
}

async function readLessons(transaction: Prisma.TransactionClient, userId: string): Promise<TutorialLessonsProgress | null> {
  const user = await transaction.user.findFirst({
    where: { id: userId, anonymizedAt: null },
    select: { tutorialCompletedAt: true },
  })
  if (!user) return null
  const records = await transaction.tutorialCompletionRecord.findMany({ where: { userId }, take: 4 })
  const progress: TutorialLessonsProgress = {
    schemaVersion: 1,
    base: { legacyCredit: user.tutorialCompletedAt ? { origin: 'legacy', completedAt: user.tutorialCompletedAt.toISOString() } : null, completion: null },
    additional: { completion: null },
  }
  for (const record of records) {
    if (record.lessonId === 'base' && record.versionKey === 'legacy' && record.origin === 'legacy' && record.completedAt === null) {
      progress.base.legacyCredit ??= { origin: 'legacy', completedAt: null }
    } else if (record.lessonId === 'base' && record.versionKey === 'base-simple-v1' && record.origin === 'scenario' && record.completedAt) {
      progress.base.completion = { origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: record.completedAt.toISOString() }
    } else if (record.lessonId === 'additional' && record.versionKey === 'additional-standard-v1' && record.origin === 'scenario' && record.completedAt) {
      progress.additional.completion = { origin: 'scenario', scenarioVersion: 'additional-standard-v1', completedAt: record.completedAt.toISOString() }
    } else {
      throw new Error('Invalid persisted tutorial progress')
    }
  }
  return tutorialLessonsProgressSchema.parse(progress)
}

// Account deletion anonymizes User; an FK cascade alone would retain private progress.
export async function eraseTutorialProgressInTransaction(transaction: Prisma.TransactionClient, userId: string) {
  await transaction.tutorialCompletionRecord.deleteMany({ where: { userId } })
}
