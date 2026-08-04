import type { DbClient } from '../../../db'
import type { TutorialProgressRepository } from '../application/ports'

export function createPrismaTutorialProgressRepository(db: DbClient): TutorialProgressRepository {
  return {
    async read(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { tutorialCompletedAt: true },
      })
      return user?.tutorialCompletedAt ?? null
    },

    async complete(userId, completedAt) {
      await db.user.updateMany({
        where: { id: userId, tutorialCompletedAt: null },
        data: { tutorialCompletedAt: completedAt },
      })
      const user = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tutorialCompletedAt: true },
      })
      return user.tutorialCompletedAt ?? completedAt
    },
  }
}
