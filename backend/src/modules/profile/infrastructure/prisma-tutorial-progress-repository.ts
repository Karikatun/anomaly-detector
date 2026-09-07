import type { DbClient } from '../../../db'
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
  }
}
