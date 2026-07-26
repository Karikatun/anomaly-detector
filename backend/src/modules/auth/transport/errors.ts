import { AppError } from '../../../http/errors'
import { AuthFailure } from '../domain/errors'

export function toAuthAppError(error: unknown) {
  if (!(error instanceof AuthFailure)) return error

  if (error.kind === 'login_already_exists') {
    return new AppError(409, 'CONFLICT', error.message)
  }
  if (error.kind === 'login_throttled') {
    return new AppError(429, 'RATE_LIMITED', error.message)
  }
  if (error.kind === 'registration_limited') {
    return new AppError(429, 'RATE_LIMITED', error.message)
  }

  return new AppError(401, 'UNAUTHORIZED', error.message)
}

export async function executeAuth<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toAuthAppError(error)
  }
}
