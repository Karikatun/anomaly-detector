export type RealtimeFailureKind =
  | 'realtime_session_invalid'
  | 'realtime_subscription_limit'
  | 'realtime_ticket_expired'
  | 'realtime_ticket_invalid'
  | 'realtime_ticket_used'

export class RealtimeFailure extends Error {
  constructor(
    public readonly kind: RealtimeFailureKind,
    message: string,
  ) {
    super(message)
  }
}

export type RealtimePrincipal = {
  sessionId: string
  userId: string
}
