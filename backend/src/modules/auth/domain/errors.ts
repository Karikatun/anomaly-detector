export type AuthFailureKind =
  | 'access_token_invalid'
  | 'access_token_required'
  | 'email_already_exists'
  | 'invalid_credentials'
  | 'oauth_not_configured'
  | 'refresh_session_invalid'
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
