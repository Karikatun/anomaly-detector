import { AppError } from '../../../http/errors'
import { MailPolicyFailure } from '../domain/errors'

export async function executeMailPolicy<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof MailPolicyFailure)) throw error
    if (error.kind === 'recent_authentication_required') {
      throw new AppError(403, 'FORBIDDEN', error.message, undefined, error.kind)
    }
    if (error.kind === 'invalid_domain') {
      throw new AppError(400, 'BAD_REQUEST', error.message)
    }
    if (error.kind === 'source_import_failed') {
      throw new AppError(502, 'INTERNAL_ERROR', 'Mail registry source is unavailable')
    }
    throw new AppError(409, 'CONFLICT', error.message)
  }
}
