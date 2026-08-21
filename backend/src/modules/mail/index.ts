import type { DbClient } from '../../db'
import { MailPolicyService } from './application/mail-policy-service'
import type { Clock, MailServiceCandidateSource } from './application/ports'
import { createPrismaMailPolicyRepository } from './infrastructure/prisma-mail-policy-repository'
import { RknMailServiceCandidateSource } from './infrastructure/rkn-mail-service-candidate-source'

export function createMailModule(input: {
  clock?: Clock
  db: DbClient
  source?: MailServiceCandidateSource
}) {
  const service = new MailPolicyService({
    clock: input.clock ?? { now: () => new Date() },
    repository: createPrismaMailPolicyRepository(input.db),
    source: input.source ?? new RknMailServiceCandidateSource(),
  })
  return {
    operatorPolicy: service,
    policy: {
      evaluate: (emailDomain: string) => service.evaluate(emailDomain),
    },
  }
}

export type { MailServiceCandidateSource } from './application/ports'
export { executeMailPolicy } from './transport/errors'
