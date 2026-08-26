import { createHash } from 'node:crypto'

import type {
  MailPolicyStatusCommand,
  MailPolicySyncCommand,
  MailPolicyView,
} from '@anomaly-detector/contracts'

import { MailPolicyFailure } from '../domain/errors'
import {
  APPROVED_MAIL_PROVIDER_CATALOG,
} from './approved-mail-provider-catalog'
import {
  classifyMailDomain,
  normalizeMailDomain,
  type MxResolution,
  type MxResolver,
} from './mail-domain-classifier'
import type {
  Clock,
  MailPolicyCommitResult,
  MailPolicyOperator,
  MailPolicyRepository,
  MailPolicyCommandReceipt,
  StoredMailPolicyCommand,
} from './ports'

const RECENT_AUTHENTICATION_MS = 10 * 60 * 1_000
const AUTHENTICATION_CLOCK_SKEW_MS = 30 * 1_000
const ASSESSMENT_TTL_MS = 5 * 60 * 1_000
const RETRY_ASSESSMENT_TTL_MS = 30 * 1_000

export class MailPolicyService {
  private readonly assessmentRefreshes = new Map<string, Promise<void>>()

  constructor(private readonly dependencies: {
    clock: Clock
    mxResolver: MxResolver
    repository: MailPolicyRepository
  }) {}

  read(): Promise<MailPolicyView> {
    return this.dependencies.repository.readView(
      this.dependencies.clock.now(),
      APPROVED_MAIL_PROVIDER_CATALOG,
    )
  }

  async evaluate(emailDomainInput: string, options: { forceMxRefresh?: boolean } = {}) {
    const emailDomain = normalizeEmailDomain(emailDomainInput)
    const now = this.dependencies.clock.now()
    const current = await this.dependencies.repository.evaluate(emailDomain, now)
    if (current.source === 'public_domain') return current

    const catalogIsPublished = current.catalogVersion === APPROVED_MAIL_PROVIDER_CATALOG.version
    if (!catalogIsPublished && !options.forceMxRefresh) {
      return current
    }
    if (catalogIsPublished && !current.requiresMxAssessment && !options.forceMxRefresh) {
      return current
    }

    await this.refreshAssessment(emailDomain, now, options.forceMxRefresh === true)
    return this.dependencies.repository.evaluate(emailDomain, now)
  }

  private async refreshAssessment(emailDomain: string, now: Date, forceMxRefresh: boolean) {
    const existing = this.assessmentRefreshes.get(emailDomain)
    if (existing) return existing

    const refresh = (async () => {
      if (!forceMxRefresh) {
        const latest = await this.dependencies.repository.evaluate(emailDomain, now)
        if (!latest.requiresMxAssessment) return
      }
      await this.resolveAndStoreAssessment(emailDomain, now)
    })()
      .finally(() => {
        if (this.assessmentRefreshes.get(emailDomain) === refresh) {
          this.assessmentRefreshes.delete(emailDomain)
        }
      })
    this.assessmentRefreshes.set(emailDomain, refresh)
    return refresh
  }

  private async resolveAndStoreAssessment(emailDomain: string, now: Date) {
    const mx = await this.dependencies.mxResolver.resolve(emailDomain)
    const classification = classifyMailDomain({ emailDomain, mx })
    const retry = classification.kind === 'retry'
    await this.dependencies.repository.storeAssessment({
      catalogVersion: APPROVED_MAIL_PROVIDER_CATALOG.version,
      checkedAt: now,
      emailDomain,
      expiresAt: new Date(now.getTime() + (retry ? RETRY_ASSESSMENT_TTL_MS : ASSESSMENT_TTL_MS)),
      failureCode: classification.kind === 'allowed' ? null : classification.reason,
      mxFingerprint: fingerprintMx(mx),
      outcome: classification.kind === 'allowed' ? 'allowed' : classification.kind,
      providerId: classification.kind === 'allowed' ? classification.providerId : null,
    })
  }

  async syncCatalog(command: MailPolicySyncCommand, operator: MailPolicyOperator) {
    this.requireRecentAuthentication(operator.authenticatedAt)
    const fingerprint = fingerprintOf({
      catalogVersion: APPROVED_MAIL_PROVIDER_CATALOG.version,
      expectedVersion: command.expectedVersion,
      type: 'sync-catalog',
    })
    const existing = await this.dependencies.repository.findCommand(command.commandId)
    if (existing) return this.resolveExisting(existing, fingerprint)
    return this.resolveCommit(await this.dependencies.repository.syncCatalog({
      actorId: operator.id,
      catalog: APPROVED_MAIL_PROVIDER_CATALOG,
      commandId: command.commandId,
      expectedVersion: command.expectedVersion,
      fingerprint,
    }), fingerprint)
  }

  async changeStatus(command: MailPolicyStatusCommand, operator: MailPolicyOperator) {
    this.requireRecentAuthentication(operator.authenticatedAt)
    const normalized = {
      expectedVersion: command.expectedVersion,
      providerId: command.providerId,
      reason: command.reason.trim(),
      state: command.state,
      type: 'change-status',
    } as const
    const fingerprint = fingerprintOf(normalized)
    const existing = await this.dependencies.repository.findCommand(command.commandId)
    if (existing) return this.resolveExisting(existing, fingerprint)
    return this.resolveCommit(await this.dependencies.repository.changeStatus({
      actorId: operator.id,
      commandId: command.commandId,
      expectedVersion: normalized.expectedVersion,
      fingerprint,
      providerId: normalized.providerId,
      reason: normalized.reason,
      state: normalized.state,
    }), fingerprint)
  }

  private requireRecentAuthentication(authenticatedAt: Date) {
    const age = this.dependencies.clock.now().getTime() - authenticatedAt.getTime()
    if (age > RECENT_AUTHENTICATION_MS || age < -AUTHENTICATION_CLOCK_SKEW_MS) {
      throw new MailPolicyFailure(
        'recent_authentication_required',
        'Recent authentication is required for mail policy commands',
      )
    }
  }

  private async resolveExisting(existing: StoredMailPolicyCommand, fingerprint: string) {
    if (existing.fingerprint !== fingerprint) {
      throw new MailPolicyFailure('command_conflict', 'Command identifier was already used for another request')
    }
    return this.resolveReceipt(existing.receipt)
  }

  private async resolveCommit(result: MailPolicyCommitResult, fingerprint: string) {
    if (result.kind === 'command_exists') return this.resolveExisting(result, fingerprint)
    if (result.kind === 'version_conflict') {
      throw new MailPolicyFailure('version_conflict', 'Mail policy version changed before the command committed')
    }
    if (result.kind === 'catalog_version_conflict') {
      throw new MailPolicyFailure('catalog_version_conflict', 'Mail provider catalog version must advance when definitions change')
    }
    if (result.kind === 'provider_not_found') {
      throw new MailPolicyFailure('provider_not_found', 'Mail provider was not found in the current policy')
    }
    return this.resolveReceipt(result.receipt)
  }

  private async resolveReceipt(_receipt: MailPolicyCommandReceipt) {
    return this.read()
  }
}

export function normalizeEmailDomain(value: string) {
  return normalizeMailDomain(value)
}

function fingerprintOf(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function fingerprintMx(mx: MxResolution) {
  if (mx.kind !== 'resolved') return null
  return fingerprintOf([...mx.exchanges].map((value) => value.trim().toLowerCase()).sort())
}
