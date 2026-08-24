export type StoredTransactionalMailTemplate =
  | {
      addressRole?: 'account' | 'recovery'
      expiresAt: string
      kind: 'account_email_confirmation'
      recoveryPurpose?: 'replacement_new' | 'replacement_old'
    }
  | {
      expiresAt: string
      kind: 'password_recovery'
      recoveryUrl: string
    }
  | {
      event: 'password_changed' | 'recovery_email_changed'
      kind: 'security_notification'
      occurredAt: string
    }

export type TransactionalMailWrite = {
  fingerprint: string
  messageId: string
  recipient: string
  recipientDomain: string
  template: StoredTransactionalMailTemplate
}

export type TransactionalMailWriteResult =
  | { kind: 'inserted' }
  | { fingerprint: string; kind: 'exists' }

export type TransactionalMailWriter = {
  enqueue(input: TransactionalMailWrite): Promise<TransactionalMailWriteResult>
}

export type RenderedTransactionalMail = {
  createdAt: Date
  messageId: string
  recipient: string
  subject: string
  text: string
}

export type TransactionalMailDeliveryResult =
  | { kind: 'accepted' }
  | {
      ambiguous: boolean
      code: string
      kind: 'temporary_failure'
    }
  | {
      code: string
      kind: 'terminal_failure'
    }

export type TransactionalMailDelivery = {
  send(message: RenderedTransactionalMail): Promise<TransactionalMailDeliveryResult>
}

export type ClaimedTransactionalMail = {
  attemptCount: number
  createdAt: Date
  deliveryBudgetWindowStartedAt: Date
  id: string
  messageId: string
  providerMessageId: string
  recipient: string
  recipientDomain: string
  template: unknown
}

export type MailDeliveryProtectionAlert = {
  occurredAt: Date
  reason: 'delivery_budget_exhausted' | 'delivery_circuit_open'
}

export type ClaimedMailDeliveryProtectionAlert = MailDeliveryProtectionAlert & {
  transitionAt: Date
}

export type MailOutboxFailureState = 'queued' | 'stale_claim' | 'terminal_failure'

export type MailOutboxRecordFailureResult = {
  protectionAlert?: MailDeliveryProtectionAlert
  state: MailOutboxFailureState
}

export type MailOutboxClaimResult =
  | { kind: 'budget_exhausted'; protectionAlert?: MailDeliveryProtectionAlert }
  | { kind: 'circuit_open' | 'empty' }
  | { kind: 'claimed'; message: ClaimedTransactionalMail }

export type MailOutboxRepository = {
  acknowledgeProtectionAlert(input: {
    now: Date
    reason: MailDeliveryProtectionAlert['reason']
    transitionAt: Date
    workerId: string
  }): Promise<boolean>
  claim(input: {
    now: Date
    workerId: string
  }): Promise<MailOutboxClaimResult>
  claimProtectionAlerts(input: {
    limit: number
    now: Date
    workerId: string
  }): Promise<ClaimedMailDeliveryProtectionAlert[]>
  recordAccepted(input: {
    id: string
    now: Date
    workerId: string
  }): Promise<boolean>
  recordFailure(input: {
    affectsCircuit: boolean
    code: string
    id: string
    now: Date
    temporary: boolean
    workerId: string
  }): Promise<MailOutboxRecordFailureResult>
  releaseBlocked(input: {
    deliveryBudgetWindowStartedAt: Date
    id: string
    now: Date
    workerId: string
  }): Promise<boolean>
}

export type MailDeliveryPolicy = {
  evaluate(emailDomain: string): Promise<{
    acceptsNewAddress: boolean
    allowsRecoveryDelivery: boolean
  }>
}
