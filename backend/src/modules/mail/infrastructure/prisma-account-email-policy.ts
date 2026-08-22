import { z } from 'zod'

import type { Prisma } from '../../../generated/prisma/client'
import {
  accountEmailDomain,
  canonicalizeAccountEmailWithDecision,
} from '../application/approved-account-email'
import type { MailPolicyDecision } from '../application/ports'
import { lockMailPolicyTransaction } from './mail-policy-lock'

export type TransactionalAccountEmailPolicy = {
  acceptsNewAddress: boolean
  allowsRecoveryDelivery: boolean
  canonicalKey: string
  policyVersion: number
  providerValue: string
  state: MailPolicyDecision['state']
}

export async function evaluateTransactionalAccountEmail(
  transaction: Pick<Prisma.TransactionClient, '$queryRaw' | 'mailPolicyVersion'>,
  value: string,
): Promise<TransactionalAccountEmailPolicy | null> {
  const emailDomain = accountEmailDomain(value)
  if (!emailDomain) return null

  await lockMailPolicyTransaction(transaction)
  const policy = await transaction.mailPolicyVersion.findFirst({
    orderBy: { version: 'desc' },
    include: { entries: { where: { emailDomain } } },
  })
  const entry = policy?.entries[0]
  const state = entry
    ? z.enum(['approved', 'deprecated', 'blocked']).parse(entry.state)
    : 'unlisted'
  const decision: MailPolicyDecision = {
    acceptsNewAddress: state === 'approved',
    allowsRecoveryDelivery: state === 'approved' || state === 'deprecated',
    canonicalization: entry
      ? {
          ignoreDots: entry.ignoreDots,
          localPartCaseInsensitive: entry.localPartCaseInsensitive,
          stripPlusTag: entry.stripPlusTag,
        }
      : null,
    state,
    version: policy?.version ?? 0,
  }
  const email = canonicalizeAccountEmailWithDecision(value, decision)
  if (!email) return null

  return {
    acceptsNewAddress: decision.acceptsNewAddress,
    allowsRecoveryDelivery: decision.allowsRecoveryDelivery,
    canonicalKey: email.canonicalKey,
    policyVersion: decision.version,
    providerValue: email.providerValue,
    state: decision.state,
  }
}
