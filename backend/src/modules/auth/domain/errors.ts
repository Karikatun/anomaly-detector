export type AuthFailureKind =
  | 'access_token_invalid'
  | 'access_token_required'
  | 'login_already_exists'
  | 'invalid_credentials'
  | 'login_throttled'
  | 'oauth_not_configured'
  | 'oauth_registration_consent_required'
  | 'oauth_transaction_invalid'
  | 'registration_limited'
  | 'refresh_session_invalid'
  | 'refresh_token_reused'
  | 'refresh_token_required'
  | 'session_invalid'

export class AuthFailure extends Error {
  constructor(
    public readonly kind: AuthFailureKind,
    message: string,
  ) {
    super(message)
  }
}
