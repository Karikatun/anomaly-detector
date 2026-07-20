export type TenderFailureKind =
  | 'duplicate_command_conflict'
  | 'invalid_create_tender'
  | 'invalid_tender_command'
  | 'invalid_tender_state'
  | 'invalid_tender_view_query'
  | 'player_not_in_tender'
  | 'tender_not_found'
  | 'tender_version_conflict'

export class TenderFailure extends Error {
  constructor(
    public readonly kind: TenderFailureKind,
    message: string,
  ) {
    super(message)
  }
}
