import { AppError } from '../../../http/errors'
import { FeedbackFailure } from '../domain/errors'

export async function executeFeedbackOperator<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof FeedbackFailure)) throw error
    if (error.kind === 'report_not_found') {
      throw new AppError(404, 'NOT_FOUND', error.message)
    }
    throw new AppError(409, 'CONFLICT', error.message)
  }
}
