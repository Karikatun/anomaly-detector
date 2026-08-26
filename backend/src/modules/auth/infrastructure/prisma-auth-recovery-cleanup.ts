import type { Prisma } from '../../../generated/prisma/client'

type AuthRecoveryCleanupDb = Pick<
  Prisma.TransactionClient,
  | 'passwordResetCredential'
  | 'recoveryCodeEmailReplacement'
  | 'recoveryCodeReissueChallenge'
  | 'recoveryEmailChallenge'
  | 'recoveryEmailReplacement'
>

const expiredRecoveryEmailCodeHash = '0'.repeat(64)

export async function cleanupExpiredAuthRecovery(
  db: AuthRecoveryCleanupDb,
  now: Date,
) {
  const recoveryEmailChallenges = await db.recoveryEmailChallenge.deleteMany({
    where: { expiresAt: { lte: now } },
  })
  const expiredOldReplacementFactors = await db.recoveryEmailReplacement.updateMany({
    where: {
      oldCodeHash: { not: expiredRecoveryEmailCodeHash },
      oldExpiresAt: { lte: now },
    },
    data: { oldCodeHash: expiredRecoveryEmailCodeHash },
  })
  const expiredNewReplacementFactors = await db.recoveryEmailReplacement.updateMany({
    where: {
      newCodeHash: { not: expiredRecoveryEmailCodeHash },
      newExpiresAt: { lte: now },
    },
    data: { newCodeHash: expiredRecoveryEmailCodeHash },
  })
  const recoveryEmailReplacements = await db.recoveryEmailReplacement.deleteMany({
    where: {
      AND: [
        { newExpiresAt: { lte: now } },
        { oldExpiresAt: { lte: now } },
      ],
    },
  })
  const recoveryCodeReissues = await db.recoveryCodeReissueChallenge.deleteMany({
    where: { expiresAt: { lte: now } },
  })
  const recoveryCodeEmailReplacements = await db.recoveryCodeEmailReplacement.deleteMany({
    where: { newExpiresAt: { lte: now } },
  })
  const passwordResetCredentials = await db.passwordResetCredential.deleteMany({
    where: { expiresAt: { lte: now } },
  })

  return {
    count:
      recoveryEmailChallenges.count
      + expiredOldReplacementFactors.count
      + expiredNewReplacementFactors.count
      + recoveryEmailReplacements.count
      + recoveryCodeReissues.count
      + recoveryCodeEmailReplacements.count
      + passwordResetCredentials.count,
  }
}
