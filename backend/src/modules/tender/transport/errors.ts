import { AppError } from '../../../http/errors'
import { TenderFailure } from '../domain/errors'

export async function executeTender<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof TenderFailure)) throw error
    if (error.kind === 'tender_not_found' || error.kind === 'player_not_in_tender') {
      throw new AppError(404, 'NOT_FOUND', 'Tender not found')
    }
    if (error.kind === 'tender_deadline_expired') {
      throw new AppError(409, 'TENDER_DEADLINE_EXPIRED', 'Tender action deadline expired')
    }
    if (error.kind === 'contract_evidence_stale') {
      throw new AppError(409, 'TENDER_EVIDENCE_UNAVAILABLE', 'Selected Contract evidence is no longer available')
    }
    if (error.kind === 'player_forfeited') {
      throw new AppError(403, 'TENDER_PLAYER_FORFEITED', 'Tender access is unavailable')
    }
    if (error.kind === 'duplicate_command_conflict') {
      throw new AppError(409, 'TENDER_COMMAND_CONFLICT', 'Tender command conflicts with its first use')
    }
    if (error.kind === 'tender_version_conflict') {
      throw new AppError(409, 'TENDER_VERSION_CONFLICT', 'Tender state changed before the command committed')
    }
    if (error.kind === 'invalid_tender_state') {
      throw new AppError(409, 'TENDER_ACTION_UNAVAILABLE', 'Tender action is unavailable')
    }
    throw new AppError(400, 'BAD_REQUEST', error.message)
  }
}

export async function executeTenderRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof TenderFailure)) throw error
    if (error.kind === 'tender_not_found' || error.kind === 'player_not_in_tender') {
      throw new AppError(404, 'NOT_FOUND', 'Tender not found')
    }
    if (error.kind === 'player_forfeited') {
      throw new AppError(403, 'TENDER_PLAYER_FORFEITED', 'Tender access is unavailable')
    }
    throw new AppError(400, 'BAD_REQUEST', error.message)
  }
}
