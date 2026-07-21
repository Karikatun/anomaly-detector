export type RealtimeFailureKind =
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
