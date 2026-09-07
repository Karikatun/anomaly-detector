import { randomUUID } from 'node:crypto'

import type { Prisma } from '../../../generated/prisma/client'
import { cancelQueuedTransactionalMail } from '../../mail'

const accountTombstoneLoginPattern = /^deleted-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function erasePrismaAccountIdentityInTransaction(
  transaction: Prisma.TransactionClient,
  input: {
    anonymizedAt?: Date
    currentLogin?: string
    now: Date
    userId: string
  },
) {
  await cancelOutstandingRecoveryCredentials(transaction, input.userId, input.now)
  await transaction.recoveryCode.deleteMany({ where: { userId: input.userId } })
  await transaction.recoveryCodeSet.deleteMany({ where: { userId: input.userId } })
  await transaction.recoveryEmailBinding.deleteMany({ where: { userId: input.userId } })
  await transaction.authIdentity.deleteMany({ where: { userId: input.userId } })
  await transaction.authSession.deleteMany({ where: { userId: input.userId } })
  await transaction.currentMatch.deleteMany({ where: { userId: input.userId } })
  await transaction.user.update({
    where: { id: input.userId },
    data: {
      ...(input.anonymizedAt ? { anonymizedAt: input.anonymizedAt } : {}),
      accountEmailCanonicalKey: null,
      accountEmailProviderValue: null,
      accountEmailState: 'absent',
      deletionCleanupCompletedAt: null,
      displayName: null,
      locale: 'ru',
      login: input.currentLogin && accountTombstoneLoginPattern.test(input.currentLogin)
        ? input.currentLogin
        : `deleted-${randomUUID()}`,
      passwordHash: null,
      privacyConsentAt: null,
      privacyConsentVersion: null,
      termsAcceptedAt: null,
      termsVersion: null,
      tutorialCompletedAt: null,
    },
  })
}

export async function cancelOutstandingRecoveryCredentials(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const challenge = await transaction.recoveryEmailChallenge.findUnique({ where: { userId } })
  const replacement = await transaction.recoveryEmailReplacement.findUnique({ where: { userId } })
  const reissue = await transaction.recoveryCodeReissueChallenge.findUnique({ where: { userId } })
  const codeReplacement = await transaction.recoveryCodeEmailReplacement.findUnique({
    where: { userId },
  })
  const passwordReset = await transaction.passwordResetCredential.findUnique({ where: { userId } })
  const messageIds = [
    challenge?.messageId,
    replacement?.oldMessageId,
    replacement?.newMessageId,
    reissue?.messageId,
    codeReplacement?.newMessageId,
    passwordReset?.messageId,
  ].filter((messageId): messageId is string => Boolean(messageId))
  for (const messageId of messageIds) {
    await cancelQueuedTransactionalMail(transaction, { messageId, now })
  }
  await transaction.recoveryEmailChallenge.deleteMany({ where: { userId } })
  await transaction.recoveryEmailReplacement.deleteMany({ where: { userId } })
  await transaction.recoveryCodeReissueChallenge.deleteMany({ where: { userId } })
  await transaction.recoveryCodeEmailReplacement.deleteMany({ where: { userId } })
  await transaction.passwordResetCredential.deleteMany({ where: { userId } })
}
