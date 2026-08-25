import type { Prisma } from '../../../generated/prisma/client'
import {
  accountEmailDomain,
  canonicalizeAccountEmailWithDecision,
} from '../application/approved-account-email'
import type { MailPolicyDecision } from '../application/ports'
import { lockMailPolicyTransaction } from './mail-policy-lock'
import {
  evaluateMailPolicySnapshot,
  evaluateMailProviderSnapshot,
} from './prisma-mail-policy-repository'

export type TransactionalAccountEmailPolicy = {
  acceptsNewAddress: boolean
  allowsRecoveryDelivery: boolean
  canonicalKey: string
  policyVersion: number
  providerId: string | null
  providerValue: string
  state: MailPolicyDecision['state']
}

export async function evaluateTransactionalAccountEmail(
  transaction: Pick<Prisma.TransactionClient, '$queryRaw' | 'mailDomainAssessment' | 'mailPolicyVersion'>,
  value: string,
  now: Date,
): Promise<TransactionalAccountEmailPolicy | null> {
  const emailDomain = accountEmailDomain(value)
  if (!emailDomain) return null

  await lockMailPolicyTransaction(transaction)
  const [policy, assessment] = await Promise.all([
    transaction.mailPolicyVersion.findFirst({
      orderBy: { version: 'desc' },
      include: { entries: { where: { emailDomain } } },
    }),
    transaction.mailDomainAssessment.findUnique({ where: { emailDomain } }),
  ])
  const decision: MailPolicyDecision = evaluateMailPolicySnapshot({
    assessment,
    emailDomain,
    now,
    policy,
  })
  const email = canonicalizeAccountEmailWithDecision(value, decision)
  if (!email) return null

  return {
    acceptsNewAddress: decision.acceptsNewAddress,
    allowsRecoveryDelivery: decision.allowsRecoveryDelivery,
    canonicalKey: email.canonicalKey,
    policyVersion: decision.version,
    providerId: decision.providerId,
    providerValue: email.providerValue,
    state: decision.state,
  }
}

export async function evaluateTransactionalMailProvider(
  transaction: Pick<Prisma.TransactionClient, '$queryRaw' | 'mailPolicyVersion'>,
  providerId: string,
) {
  await lockMailPolicyTransaction(transaction)
  const policy = await transaction.mailPolicyVersion.findFirst({
    orderBy: { version: 'desc' },
    select: { providerCatalog: true, version: true },
  })
  return evaluateMailProviderSnapshot({ policy, providerId })
}
