export type StoredTransactionalMailTemplate =
  | {
      addressRole?: 'account' | 'recovery'
      expiresAt: string
      kind: 'account_email_confirmation'
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
  id: string
  messageId: string
  providerMessageId: string
  recipient: string
  recipientDomain: string
  template: unknown
}

export type MailOutboxClaimResult =
  | { kind: 'budget_exhausted' | 'circuit_open' | 'empty' }
  | { kind: 'claimed'; message: ClaimedTransactionalMail }

export type MailOutboxRepository = {
  claim(input: {
    now: Date
    workerId: string
  }): Promise<MailOutboxClaimResult>
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
  }): Promise<'queued' | 'stale_claim' | 'terminal_failure'>
  releaseBlocked(input: {
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
