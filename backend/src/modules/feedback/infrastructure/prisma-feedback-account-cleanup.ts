import type { DbTransaction } from '../../../db'

export async function unlinkFeedbackAccountInTransaction(
  transaction: DbTransaction,
  userId: string,
) {
  await transaction.feedbackReport.updateMany({
    where: { linkedUserId: userId },
    data: { linkedUserId: null },
  })
}
