import type { DbClient } from '../../db'
import type { Prisma } from '../../generated/prisma/client'
import { MailPolicyService } from './application/mail-policy-service'
import { MailDeliveryProtectionAlertService } from './application/mail-delivery-protection-alert-service'
import { TransactionalMailDeliveryService } from './application/transactional-mail-delivery-service'
import type {
  MailDeliveryPolicy,
  TransactionalMailDelivery,
} from './application/transactional-mail-ports'
import { TransactionalMailService } from './application/transactional-mail-service'
import type { MxResolver } from './application/mail-domain-classifier'
import type { Clock } from './application/ports'
import { createAccountEmailCanonicalizer } from './application/approved-account-email'
import {
  cleanupExpiredMailDomainAssessments,
  createPrismaMailPolicyRepository,
} from './infrastructure/prisma-mail-policy-repository'
import {
  evaluateTransactionalAccountEmail,
  evaluateTransactionalMailProvider,
} from './infrastructure/prisma-account-email-policy'
import { createPrismaMailDeliveryOverviewReader } from './infrastructure/prisma-mail-delivery-overview-reader'
import { createPrismaMailProtectionAlertStateReader } from './infrastructure/prisma-mail-protection-alert-state-reader'
import { NodeMxResolver } from './infrastructure/node-mx-resolver'
import {
  cleanupExpiredPendingMailOutbox,
  cleanupTerminalMailOutbox,
} from './infrastructure/prisma-mail-outbox-cleanup'
import {
  cancelQueuedTransactionalMail,
  createPrismaMailOutboxRepository,
  createPrismaTransactionalMailWriter,
  type MailOutboxRepositoryOptions,
} from './infrastructure/prisma-transactional-mail-outbox'
import { RegRuSmtpDelivery, type RegRuSmtpConfig } from './infrastructure/reg-ru-smtp-delivery'

export function createMailModule(input: {
  accountLifecycleSecret: string
  clock?: Clock
  confirmationCodeSecret?: string
  db: DbClient
  delivery?: TransactionalMailDelivery
  deliveryOptions?: MailOutboxRepositoryOptions
  deliveryStatus?: {
    configured: boolean
    deliveryBudgetPerMinute: number
  }
  mxResolver?: MxResolver
}) {
  const clock = input.clock ?? { now: () => new Date() }
  const service = new MailPolicyService({
    clock,
    mxResolver: input.mxResolver ?? new NodeMxResolver(),
    repository: createPrismaMailPolicyRepository(input.db, input.accountLifecycleSecret),
  })
  const accountEmailCanonicalizer = createAccountEmailCanonicalizer({
    evaluate: (emailDomain, options) => service.evaluate(emailDomain, options),
  })
  const policy: MailDeliveryPolicy = {
    evaluate: (emailDomain, options) => service.evaluate(emailDomain, options),
  }
  const outboxRepository = input.deliveryOptions
    ? createPrismaMailOutboxRepository(input.db, input.deliveryOptions)
    : null
  const protectionAlertDispatcher = outboxRepository
    ? new MailDeliveryProtectionAlertService({ clock, repository: outboxRepository })
    : null
  const outboxDrainer = input.delivery && outboxRepository
    ? new TransactionalMailDeliveryService({
        clock,
        confirmationCodeSecret: input.confirmationCodeSecret ?? '',
        delivery: input.delivery,
        policy,
        repository: outboxRepository,
      })
    : null
  if (input.delivery && !input.deliveryOptions) {
    throw new Error('Mail outbox options must be configured with delivery')
  }
  if (input.delivery && !input.confirmationCodeSecret) {
    throw new Error('Mail confirmation code secret must be configured with delivery')
  }
  const deliveryOverview = createPrismaMailDeliveryOverviewReader(input.db, input.deliveryStatus ?? {
    configured: input.delivery !== undefined,
    deliveryBudgetPerMinute: input.deliveryOptions?.deliveryBudgetPerMinute ?? 60,
  })
  const protectionAlertStateReader = createPrismaMailProtectionAlertStateReader(input.db)
  const readOperationsView = async (policyView: Awaited<ReturnType<typeof service.read>>) => ({
    ...policyView,
    delivery: await deliveryOverview.read(clock.now()),
  })
  const operatorPolicy = {
    changeStatus: async (...args: Parameters<typeof service.changeStatus>) =>
      readOperationsView(await service.changeStatus(...args)),
    read: async () => readOperationsView(await service.read()),
    syncCatalog: async (...args: Parameters<typeof service.syncCatalog>) =>
      readOperationsView(await service.syncCatalog(...args)),
  }
  return {
    accountEmailCanonicalizer,
    operatorPolicy,
    outboxDrainer,
    policy,
    protectionAlertDispatcher,
    protectionAlertStateReader,
  }
}

export function createTransactionalMailRequester(
  transaction: Pick<Prisma.TransactionClient, 'mailOutboxMessage'>,
  fingerprintKey: string,
) {
  return new TransactionalMailService(
    createPrismaTransactionalMailWriter(transaction),
    fingerprintKey,
  )
}

export function createRegRuSmtpDelivery(config: RegRuSmtpConfig) {
  return new RegRuSmtpDelivery({ config })
}

export {
  cancelQueuedTransactionalMail,
  cleanupExpiredMailDomainAssessments,
  cleanupExpiredPendingMailOutbox,
  cleanupTerminalMailOutbox,
}
export { evaluateTransactionalAccountEmail }
export { evaluateTransactionalMailProvider }
export { anonymizePrismaMailOperatorActorBatch } from './infrastructure/prisma-mail-operator-account-cleanup'
export { deriveAccountEmailConfirmationCode } from './application/account-email-confirmation-code'
export { derivePasswordResetToken } from './application/password-reset-token'

export type { MxResolver } from './application/mail-domain-classifier'
export type {
  MailProtectionAlertOperationalState,
  MailProtectionAlertStateReader,
} from './infrastructure/prisma-mail-protection-alert-state-reader'
export type { ClaimedMailDeliveryProtectionAlert } from './application/transactional-mail-ports'
export type { TransactionalMailRequest } from './application/transactional-mail-service'
export { executeMailPolicy } from './transport/errors'
