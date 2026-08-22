export type FeedbackFailureKind =
  | 'command_conflict'
  | 'contact_absent'
  | 'report_not_found'
  | 'transition_conflict'
  | 'version_conflict'

export class FeedbackFailure extends Error {
  constructor(
    public readonly kind: FeedbackFailureKind,
    message: string,
  ) {
    super(message)
  }
}
