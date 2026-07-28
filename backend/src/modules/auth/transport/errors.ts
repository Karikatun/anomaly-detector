import { AppError } from '../../../http/errors'
import { AuthFailure } from '../domain/errors'

export function toAuthAppError(error: unknown) {
  if (!(error instanceof AuthFailure)) return error

  if (error.kind === 'login_already_exists') {
    return new AppError(409, 'CONFLICT', error.message, undefined, error.kind)
  }
  if (error.kind === 'login_throttled') {
    return new AppError(429, 'RATE_LIMITED', error.message, undefined, error.kind)
  }
  if (error.kind === 'registration_limited') {
    return new AppError(429, 'RATE_LIMITED', error.message, undefined, error.kind)
  }
  if (error.kind === 'recent_authentication_required') {
    return new AppError(403, 'FORBIDDEN', error.message, undefined, error.kind)
  }

  return new AppError(401, 'UNAUTHORIZED', error.message, undefined, error.kind)
}

export async function executeAuth<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toAuthAppError(error)
  }
}
