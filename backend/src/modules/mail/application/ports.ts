import type {
  MailPolicyCanonicalization,
  MailPolicyView,
} from '@anomaly-detector/contracts'

import type { MailProviderCatalog } from './approved-mail-provider-catalog'

export type Clock = {
  now(): Date
}

export type MailPolicyOperator = {
  authenticatedAt: Date
  id: string
}

export type MailPolicyCommandReceipt = {
  kind: 'catalog_synced' | 'status_changed'
  version: number
}

export type StoredMailPolicyCommand = {
  fingerprint: string
  receipt: MailPolicyCommandReceipt
}

export type MailPolicyCommitResult =
  | ({ kind: 'command_exists' } & StoredMailPolicyCommand)
  | { kind: 'catalog_version_conflict' }
  | { kind: 'committed'; receipt: MailPolicyCommandReceipt }
  | { kind: 'provider_not_found' }
  | { kind: 'version_conflict' }

export type MailPolicyDecision = {
  acceptsNewAddress: boolean
  allowsRecoveryDelivery: boolean
  canonicalization: MailPolicyCanonicalization | null
  catalogVersion: number | null
  providerId: string | null
  requiresMxAssessment: boolean
  source?: 'mx' | 'public_domain'
  state: 'approved' | 'deprecated' | 'blocked' | 'unlisted'
  version: number
}

export type MailDomainAssessment = {
  catalogVersion: number
  checkedAt: Date
  emailDomain: string
  expiresAt: Date
  failureCode: string | null
  mxFingerprint: string | null
  outcome: 'allowed' | 'denied' | 'retry'
  providerId: string | null
}

export type MailPolicyRepository = {
  changeStatus(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
    providerId: string
    reason: string
    state: 'blocked' | 'deprecated'
  }): Promise<MailPolicyCommitResult>
  evaluate(emailDomain: string, now: Date): Promise<MailPolicyDecision>
  findCommand(commandId: string): Promise<StoredMailPolicyCommand | null>
  readView(now: Date, availableCatalog: MailProviderCatalog): Promise<MailPolicyView>
  storeAssessment(input: MailDomainAssessment): Promise<void>
  syncCatalog(input: {
    actorId: string
    catalog: MailProviderCatalog
    commandId: string
    expectedVersion: number
    fingerprint: string
  }): Promise<MailPolicyCommitResult>
}
