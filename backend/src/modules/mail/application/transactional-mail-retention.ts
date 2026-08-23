import type { StoredTransactionalMailTemplate } from './transactional-mail-ports'

const dayMs = 24 * 60 * 60 * 1_000

export const transactionalMailPendingRetentionMs = 7 * dayMs

export function transactionalMailPendingCutoff(now: Date) {
  return new Date(now.getTime() - transactionalMailPendingRetentionMs)
}

export function isTransactionalMailPastDeliveryDeadline(input: {
  createdAt: Date
  now: Date
  template: StoredTransactionalMailTemplate
}) {
  if (
    input.template.kind === 'account_email_confirmation'
    || input.template.kind === 'password_recovery'
  ) {
    return new Date(input.template.expiresAt) <= input.now
  }
  return input.createdAt <= transactionalMailPendingCutoff(input.now)
}
