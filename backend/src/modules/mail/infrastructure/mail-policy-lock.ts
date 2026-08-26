import type { Prisma } from '../../../generated/prisma/client'

const MAIL_POLICY_ADVISORY_LOCK = 4_919_726_117n

export function lockMailPolicyTransaction(
  transaction: Pick<Prisma.TransactionClient, '$queryRaw'>,
) {
  return transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(${MAIL_POLICY_ADVISORY_LOCK})::text AS lock_result
  `
}
