import { randomUUID } from 'node:crypto'

import type { MailPolicyView } from '@anomaly-detector/contracts'

import type { DbClient } from '../../backend/src/db'
import { createMailModule } from '../../backend/src/modules/mail'

const passwordRecoveryDomain = 'mail.ru'

export function passwordRecoveryRecipient(login: string) {
  return `${login}@${passwordRecoveryDomain}`
}

export function shouldEnsurePasswordRecoveryMailPolicy(
  env: { E2E_SPLIT_DOMAIN_MODE?: string },
) {
  return env.E2E_SPLIT_DOMAIN_MODE === undefined
}

export async function ensurePasswordRecoveryMailPolicy(db: DbClient) {
  const policy = createMailModule({ db }).operatorPolicy
  const current = await policy.read()
  if (allowsPasswordRecovery(current)) return

  const synced = await policy.syncCatalog({
    commandId: randomUUID(),
    expectedVersion: current.currentVersion,
  }, {
    authenticatedAt: new Date(),
    id: randomUUID(),
  })

  if (!allowsPasswordRecovery(synced)) {
    throw new Error(`Reviewed mail policy does not allow recovery delivery to ${passwordRecoveryDomain}`)
  }
}

function allowsPasswordRecovery(view: Pick<MailPolicyView, 'publishedPolicy'>) {
  return view.publishedPolicy?.providers.some((provider) =>
    provider.state !== 'blocked'
    && provider.publicDomains.some(({ emailDomain }) => emailDomain === passwordRecoveryDomain)) === true
}
