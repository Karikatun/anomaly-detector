import { createHmac } from 'node:crypto'

import { z } from 'zod'

import { normalizeEmailDomain } from './mail-policy-service'
import { isSafePasswordRecoveryBaseUrl } from './password-reset-token'
import type {
  StoredTransactionalMailTemplate,
  TransactionalMailWriter,
} from './transactional-mail-ports'

const messageBaseSchema = z.object({
  messageId: z.string().uuid(),
  recipient: z.string().trim().min(3).max(254),
})

const transactionalMailRequestSchema = z.discriminatedUnion('kind', [
  messageBaseSchema.extend({
    addressRole: z.enum(['account', 'recovery']).optional(),
    kind: z.literal('account_email_confirmation'),
    expiresAt: z.date(),
    recoveryPurpose: z.enum(['replacement_new', 'replacement_old']).optional(),
  }).strict(),
  messageBaseSchema.extend({
    kind: z.literal('password_recovery'),
    expiresAt: z.date(),
    recoveryUrl: z.string().url().max(2_048).refine(isSafePasswordRecoveryBaseUrl),
  }).strict(),
  messageBaseSchema.extend({
    kind: z.literal('security_notification'),
    event: z.enum(['password_changed', 'recovery_email_changed']),
    occurredAt: z.date(),
  }).strict(),
])

export type TransactionalMailRequest =
  | {
      messageId: string
      recipient: string
      template: {
        addressRole?: 'account' | 'recovery'
        expiresAt: Date
        kind: 'account_email_confirmation'
        recoveryPurpose?: 'replacement_new' | 'replacement_old'
      }
    }
  | {
      messageId: string
      recipient: string
      template: {
        expiresAt: Date
        kind: 'password_recovery'
        recoveryUrl: string
      }
    }
  | {
      messageId: string
      recipient: string
      template: {
        event: 'password_changed' | 'recovery_email_changed'
        kind: 'security_notification'
        occurredAt: Date
      }
    }

export class TransactionalMailFailure extends Error {
  constructor(
    readonly kind: 'invalid_request' | 'message_conflict',
    message: string,
  ) {
    super(message)
  }
}

export class TransactionalMailService {
  private readonly fingerprintKey: string

  constructor(
    private readonly writer: TransactionalMailWriter,
    fingerprintKey: string,
  ) {
    this.fingerprintKey = z.string().min(32).parse(fingerprintKey)
  }

  async enqueue(request: TransactionalMailRequest) {
    const parsed = parseRequest(request)
    const { recipient, recipientDomain } = normalizeRecipient(parsed.recipient)
    const template = toStoredTemplate(parsed)
    const fingerprint = createHmac('sha256', this.fingerprintKey)
      .update('transactional-mail-fingerprint-v1\0')
      .update(JSON.stringify({ recipient, template }))
      .digest('hex')
    const result = await this.writer.enqueue({
      fingerprint,
      messageId: parsed.messageId,
      recipient,
      recipientDomain,
      template,
    })
    if (result.kind === 'exists' && result.fingerprint !== fingerprint) {
      throw new TransactionalMailFailure(
        'message_conflict',
        'Transactional mail identifier was already used for another request',
      )
    }
    return {
      kind: result.kind === 'inserted' ? 'queued' as const : 'already_queued' as const,
      messageId: parsed.messageId,
    }
  }
}

function parseRequest(request: TransactionalMailRequest) {
  const { template, ...envelope } = request
  const flattened = { ...envelope, ...template }
  const parsed = transactionalMailRequestSchema.safeParse(flattened)
  if (!parsed.success) {
    throw new TransactionalMailFailure('invalid_request', 'Transactional mail request is invalid')
  }
  return parsed.data
}

function normalizeRecipient(value: string) {
  const separator = value.lastIndexOf('@')
  const localPart = value.slice(0, separator)
  const rawDomain = value.slice(separator + 1)
  if (
    separator <= 0
    || value.indexOf('@') !== separator
    || localPart.length > 64
    || localPart.startsWith('.')
    || localPart.endsWith('.')
    || localPart.includes('..')
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)
  ) {
    throw new TransactionalMailFailure('invalid_request', 'Transactional mail recipient is invalid')
  }
  try {
    const recipientDomain = normalizeEmailDomain(rawDomain)
    return { recipient: `${localPart}@${recipientDomain}`, recipientDomain }
  } catch {
    throw new TransactionalMailFailure('invalid_request', 'Transactional mail recipient is invalid')
  }
}

function toStoredTemplate(
  parsed: z.infer<typeof transactionalMailRequestSchema>,
): StoredTransactionalMailTemplate {
  if (parsed.kind === 'account_email_confirmation') {
    return {
      ...(parsed.addressRole ? { addressRole: parsed.addressRole } : {}),
      expiresAt: parsed.expiresAt.toISOString(),
      kind: parsed.kind,
      ...(parsed.recoveryPurpose ? { recoveryPurpose: parsed.recoveryPurpose } : {}),
    }
  }
  if (parsed.kind === 'password_recovery') {
    return {
      expiresAt: parsed.expiresAt.toISOString(),
      kind: parsed.kind,
      recoveryUrl: parsed.recoveryUrl,
    }
  }
  return {
    event: parsed.event,
    kind: parsed.kind,
    occurredAt: parsed.occurredAt.toISOString(),
  }
}
