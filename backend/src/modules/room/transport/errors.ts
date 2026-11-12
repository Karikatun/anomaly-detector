import { AppError } from '../../../http/errors'
import { gameClientUpdateMessage } from '../../../http/game-contract'
import { RoomFailure } from '../domain/errors'

export async function executeRoom<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof RoomFailure)) throw error
    if (error.kind === 'room_account_unavailable') {
      throw new AppError(401, 'UNAUTHORIZED', error.message)
    }
    if (error.kind === 'room_client_update_required') throw new AppError(409, 'CONFLICT', gameClientUpdateMessage)
    if (error.kind === 'room_not_found') throw new AppError(404, 'NOT_FOUND', error.message)
    throw new AppError(409, 'CONFLICT', error.message)
  }
}
