export type AuthFailureKind =
  | 'access_token_invalid'
  | 'access_token_required'
  | 'login_already_exists'
  | 'invalid_credentials'
  | 'login_throttled'
  | 'oauth_not_configured'
  | 'oauth_account_email_conflict'
  | 'oauth_registration_consent_required'
  | 'oauth_transaction_invalid'
  | 'recent_authentication_required'
  | 'recovery_code_invalid'
  | 'recovery_codes_unavailable'
  | 'recovery_cancellation_forbidden'
  | 'recovery_email_conflict'
  | 'recovery_email_limited'
  | 'recovery_email_pending'
  | 'recovery_email_unavailable'
  | 'recovery_password_invalid'
  | 'recovery_replacement_forbidden'
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
