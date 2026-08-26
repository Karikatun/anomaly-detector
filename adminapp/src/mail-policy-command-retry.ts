import { AdminApiError } from './api'

export function shouldRetainCommand(error: unknown) {
  if (!(error instanceof AdminApiError)) return true
  return error.status >= 500 && error.status !== 502
}
