import { AppError } from '../../../http/errors'
import { TenderFailure } from '../domain/errors'

export async function executeTender<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof TenderFailure)) throw error
    if (error.kind === 'tender_not_found') throw new AppError(404, 'NOT_FOUND', error.message)
    if (error.kind === 'player_not_in_tender') throw new AppError(403, 'FORBIDDEN', error.message)
    if (error.kind === 'duplicate_command_conflict' || error.kind === 'tender_version_conflict' || error.kind === 'invalid_tender_state') {
      throw new AppError(409, 'CONFLICT', error.message)
    }
    throw new AppError(400, 'BAD_REQUEST', error.message)
  }
}
