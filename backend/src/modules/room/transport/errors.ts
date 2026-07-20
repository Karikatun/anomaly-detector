import { AppError } from '../../../http/errors'
import { RoomFailure } from '../domain/errors'

export async function executeRoom<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof RoomFailure)) throw error
    if (error.kind === 'room_not_found') throw new AppError(404, 'NOT_FOUND', error.message)
    throw new AppError(409, 'CONFLICT', error.message)
  }
}
