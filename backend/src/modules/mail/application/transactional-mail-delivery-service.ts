import { z } from 'zod'

import { deriveAccountEmailConfirmationCode } from './account-email-confirmation-code'

import type {
  ClaimedTransactionalMail,
  MailDeliveryPolicy,
  MailOutboxRepository,
  RenderedTransactionalMail,
  StoredTransactionalMailTemplate,
  TransactionalMailDelivery,
  TransactionalMailDeliveryResult,
} from './transactional-mail-ports'

const workerIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/)
const failureCodeSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/)
const storedTemplateSchema = z.discriminatedUnion('kind', [
  z.object({
    addressRole: z.enum(['account', 'recovery']).optional(),
    expiresAt: z.string().datetime(),
    kind: z.literal('account_email_confirmation'),
  }).strict(),
  z.object({
    expiresAt: z.string().datetime(),
    kind: z.literal('password_recovery'),
    recoveryUrl: z.string().url().max(2_048).refine((value) => new URL(value).protocol === 'https:'),
  }).strict(),
  z.object({
    event: z.enum(['password_changed', 'recovery_email_changed']),
    kind: z.literal('security_notification'),
    occurredAt: z.string().datetime(),
  }).strict(),
])

export class TransactionalMailDeliveryService {
  constructor(private readonly dependencies: {
    confirmationCodeSecret: string
    delivery: TransactionalMailDelivery
    policy: MailDeliveryPolicy
    repository: MailOutboxRepository
  }) {}

  async drain(input: { limit: number; now: Date; workerId: string }) {
    const limit = z.number().int().min(1).max(100).parse(input.limit)
    const workerId = workerIdSchema.parse(input.workerId)
    const result = {
      accepted: 0,
      blocked: 0,
      budgetExhausted: false,
      circuitOpen: false,
      staleClaims: 0,
      temporaryFailures: 0,
      terminalFailures: 0,
    }

    for (let processed = 0; processed < limit; processed += 1) {
      const claim = await this.dependencies.repository.claim({ now: input.now, workerId })
      if (claim.kind !== 'claimed') {
        result.budgetExhausted = claim.kind === 'budget_exhausted'
        result.circuitOpen = claim.kind === 'circuit_open'
        break
      }

      let rendered: RenderedTransactionalMail
      let requiresNewAddress: boolean
      try {
        const prepared = prepareMessage(claim.message, this.dependencies.confirmationCodeSecret)
        rendered = prepared.rendered
        requiresNewAddress = prepared.requiresNewAddress
      } catch {
        const state = await this.dependencies.repository.recordFailure({
          affectsCircuit: false,
          code: 'stored_message_invalid',
          id: claim.message.id,
          now: input.now,
          temporary: false,
          workerId,
        })
        if (state === 'stale_claim') result.staleClaims += 1
        else result.terminalFailures += 1
        continue
      }

      let allowed = false
      try {
        const decision = await this.dependencies.policy.evaluate(claim.message.recipientDomain)
        allowed = requiresNewAddress
          ? decision.acceptsNewAddress
          : decision.allowsRecoveryDelivery
      } catch {
        allowed = false
      }
      if (!allowed) {
        const released = await this.dependencies.repository.releaseBlocked({
          id: claim.message.id,
          now: input.now,
          workerId,
        })
        if (released) result.blocked += 1
        else result.staleClaims += 1
        continue
      }

      let deliveryResult: TransactionalMailDeliveryResult
      try {
        deliveryResult = await this.dependencies.delivery.send(rendered)
      } catch {
        deliveryResult = {
          ambiguous: true,
          code: 'provider_unavailable',
          kind: 'temporary_failure',
        }
      }

      if (deliveryResult.kind === 'accepted') {
        const accepted = await this.dependencies.repository.recordAccepted({
          id: claim.message.id,
          now: input.now,
          workerId,
        })
        if (accepted) result.accepted += 1
        else result.staleClaims += 1
        continue
      }

      const state = await this.dependencies.repository.recordFailure({
        affectsCircuit: deliveryResult.kind === 'temporary_failure',
        code: safeFailureCode(deliveryResult.code),
        id: claim.message.id,
        now: input.now,
        temporary: deliveryResult.kind === 'temporary_failure',
        workerId,
      })
      if (state === 'stale_claim') result.staleClaims += 1
      else if (state === 'queued') result.temporaryFailures += 1
      else result.terminalFailures += 1
    }

    return result
  }
}

function prepareMessage(message: ClaimedTransactionalMail, confirmationCodeSecret: string) {
  const template = storedTemplateSchema.parse(message.template)
  const rendered = renderTemplate(template, message.messageId, confirmationCodeSecret)
  return {
    rendered: {
      createdAt: message.createdAt,
      messageId: message.providerMessageId,
      recipient: message.recipient,
      ...rendered,
    },
    requiresNewAddress: template.kind === 'account_email_confirmation'
      && template.addressRole !== 'recovery',
  }
}

function renderTemplate(
  template: StoredTransactionalMailTemplate,
  messageId: string,
  confirmationCodeSecret: string,
) {
  if (template.kind === 'account_email_confirmation') {
    const code = deriveAccountEmailConfirmationCode(confirmationCodeSecret, messageId)
    return {
      subject: 'Подтверждение почты — Anomaly Detector',
      text: [
        template.addressRole === 'recovery'
          ? 'Код подтверждения почты восстановления:'
          : 'Код подтверждения почты аккаунта:',
        code,
        `Код действует до ${template.expiresAt}.`,
        'Если вы не запрашивали код, просто проигнорируйте письмо.',
      ].join('\n\n'),
    }
  }
  if (template.kind === 'password_recovery') {
    return {
      subject: 'Восстановление доступа — Anomaly Detector',
      text: [
        'Для восстановления password-аккаунта откройте ссылку:',
        template.recoveryUrl,
        `Ссылка действует до ${template.expiresAt}.`,
        'Если вы не запрашивали восстановление, просто проигнорируйте письмо.',
      ].join('\n\n'),
    }
  }
  const event = template.event === 'password_changed'
    ? 'Пароль аккаунта изменён.'
    : 'Recovery Email аккаунта изменён.'
  return {
    subject: 'Уведомление о безопасности — Anomaly Detector',
    text: [
      event,
      `Время события: ${template.occurredAt}.`,
      'Если это были не вы, используйте сохранённый способ восстановления доступа.',
    ].join('\n\n'),
  }
}

function safeFailureCode(value: string) {
  const parsed = failureCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'provider_failure'
}
