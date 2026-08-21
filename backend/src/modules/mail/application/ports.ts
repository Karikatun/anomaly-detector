import type {
  MailPolicyEntry,
  MailPolicyView,
} from '@anomaly-detector/contracts'

export type Clock = {
  now(): Date
}

export type MailPolicyOperator = {
  authenticatedAt: Date
  id: string
}

export type ImportedMailServiceCandidate = {
  evidence: 'service_description_mentions_mail'
  registryEntryId: string
  serviceDomain: string
}

export type ImportedMailServiceCandidates = {
  candidates: ImportedMailServiceCandidate[]
  checksum: string
  sourceDate: string
  sourceUrl: string
}

export type MailServiceCandidateSource = {
  load(): Promise<ImportedMailServiceCandidates>
}

export type MailPolicyCommandReceipt =
  | { failureCode: string; kind: 'import_failed' | 'import_rejected' }
  | { importId: string; kind: 'import_succeeded' }
  | { kind: 'policy_published' | 'status_changed'; version: number }

export type StoredMailPolicyCommand = {
  fingerprint: string
  receipt: MailPolicyCommandReceipt
}

export type MailPolicyCommitResult =
  | ({ kind: 'command_exists' } & StoredMailPolicyCommand)
  | { kind: 'candidate_not_found' }
  | { kind: 'committed'; receipt: MailPolicyCommandReceipt }
  | { kind: 'domain_already_exists' }
  | { kind: 'domain_not_found' }
  | { kind: 'policy_limit_exceeded' }
  | { kind: 'version_conflict' }

export type MailPolicyDecision = {
  acceptsNewAddress: boolean
  allowsRecoveryDelivery: boolean
  canonicalization: MailPolicyEntry['canonicalization'] | null
  state: MailPolicyEntry['state'] | 'unlisted'
  version: number
}

export type MailPolicyRepository = {
  changeStatus(input: {
    actorId: string
    commandId: string
    emailDomain: string
    expectedVersion: number
    fingerprint: string
    reason: string
    state: 'blocked' | 'deprecated'
  }): Promise<MailPolicyCommitResult>
  commitImport(input: ImportedMailServiceCandidates & {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
  }): Promise<MailPolicyCommitResult>
  commitImportFailure(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    failureCode: string
    fingerprint: string
  }): Promise<MailPolicyCommitResult>
  evaluate(emailDomain: string): Promise<MailPolicyDecision>
  findCommand(commandId: string): Promise<StoredMailPolicyCommand | null>
  publish(input: {
    actorId: string
    additions: Array<{
      canonicalization: MailPolicyEntry['canonicalization']
      emailDomain: string
      sourceCandidateId: string
    }>
    commandId: string
    expectedVersion: number
    fingerprint: string
  }): Promise<MailPolicyCommitResult>
  readView(now: Date): Promise<MailPolicyView>
}
