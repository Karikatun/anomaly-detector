export type MailPolicyFailureKind =
  | 'catalog_version_conflict'
  | 'command_conflict'
  | 'invalid_domain'
  | 'provider_not_found'
  | 'recent_authentication_required'
  | 'version_conflict'

export class MailPolicyFailure extends Error {
  constructor(
    public readonly kind: MailPolicyFailureKind,
    message: string,
  ) {
    super(message)
  }
}
