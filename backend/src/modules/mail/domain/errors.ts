export type MailPolicyFailureKind =
  | 'candidate_not_found'
  | 'command_conflict'
  | 'domain_already_exists'
  | 'domain_not_found'
  | 'invalid_domain'
  | 'policy_limit_exceeded'
  | 'recent_authentication_required'
  | 'source_import_failed'
  | 'suspicious_mass_removal'
  | 'version_conflict'

export class MailPolicyFailure extends Error {
  constructor(
    public readonly kind: MailPolicyFailureKind,
    message: string,
  ) {
    super(message)
  }
}
