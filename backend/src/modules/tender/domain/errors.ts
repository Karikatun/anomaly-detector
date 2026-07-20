export type TenderFailureKind =
  | 'duplicate_command_conflict'
  | 'invalid_tender_command'
  | 'participant_not_in_tender'
  | 'tender_not_found'

export class TenderFailure extends Error {
  constructor(
    public readonly kind: TenderFailureKind,
    message: string,
  ) {
    super(message)
  }
}
