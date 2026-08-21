import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'

import type {
  MailPolicyImportCommand,
  MailPolicyPublishCommand,
  MailPolicyStatusCommand,
  MailPolicyView,
} from '@anomaly-detector/contracts'

import { MailPolicyFailure } from '../domain/errors'
import type {
  Clock,
  MailPolicyCommitResult,
  MailPolicyOperator,
  MailPolicyRepository,
  MailPolicyCommandReceipt,
  MailServiceCandidateSource,
  StoredMailPolicyCommand,
} from './ports'

const RECENT_AUTHENTICATION_MS = 10 * 60 * 1_000
const AUTHENTICATION_CLOCK_SKEW_MS = 30 * 1_000

export class MailPolicyService {
  constructor(private readonly dependencies: {
    clock: Clock
    repository: MailPolicyRepository
    source: MailServiceCandidateSource
  }) {}

  read(): Promise<MailPolicyView> {
    return this.dependencies.repository.readView(this.dependencies.clock.now())
  }

  evaluate(emailDomain: string) {
    return this.dependencies.repository.evaluate(normalizeEmailDomain(emailDomain))
  }

  async importCandidates(command: MailPolicyImportCommand, operator: MailPolicyOperator) {
    this.requireRecentAuthentication(operator.authenticatedAt)
    const fingerprint = fingerprintOf({ type: 'import', expectedVersion: command.expectedVersion })
    const existing = await this.dependencies.repository.findCommand(command.commandId)
    if (existing) return this.resolveExisting(existing, fingerprint)

    let imported
    try {
      imported = await this.dependencies.source.load()
    } catch (error) {
      const result = await this.dependencies.repository.commitImportFailure({
        actorId: operator.id,
        commandId: command.commandId,
        expectedVersion: command.expectedVersion,
        failureCode: sourceFailureCode(error),
        fingerprint,
      })
      return this.resolveCommit(result, fingerprint)
    }
    return this.resolveCommit(await this.dependencies.repository.commitImport({
      ...imported,
      actorId: operator.id,
      commandId: command.commandId,
      expectedVersion: command.expectedVersion,
      fingerprint,
    }), fingerprint)
  }

  async publish(command: MailPolicyPublishCommand, operator: MailPolicyOperator) {
    this.requireRecentAuthentication(operator.authenticatedAt)
    const additions = command.additions
      .map((addition) => ({
        ...addition,
        emailDomain: normalizeEmailDomain(addition.emailDomain),
      }))
      .sort((left, right) => left.emailDomain.localeCompare(right.emailDomain)
        || left.sourceCandidateId.localeCompare(right.sourceCandidateId))
    if (new Set(additions.map((addition) => addition.emailDomain)).size !== additions.length) {
      throw new MailPolicyFailure('domain_already_exists', 'Published mail domains must be unique')
    }
    const fingerprint = fingerprintOf({ additions, expectedVersion: command.expectedVersion, type: 'publish' })
    const existing = await this.dependencies.repository.findCommand(command.commandId)
    if (existing) return this.resolveExisting(existing, fingerprint)
    return this.resolveCommit(await this.dependencies.repository.publish({
      actorId: operator.id,
      additions,
      commandId: command.commandId,
      expectedVersion: command.expectedVersion,
      fingerprint,
    }), fingerprint)
  }

  async changeStatus(command: MailPolicyStatusCommand, operator: MailPolicyOperator) {
    this.requireRecentAuthentication(operator.authenticatedAt)
    const emailDomain = normalizeEmailDomain(command.emailDomain)
    const normalized = {
      emailDomain,
      expectedVersion: command.expectedVersion,
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
      emailDomain: normalized.emailDomain,
      expectedVersion: normalized.expectedVersion,
      fingerprint,
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
    if (result.kind === 'candidate_not_found') {
      throw new MailPolicyFailure('candidate_not_found', 'Selected registry candidate is unavailable')
    }
    if (result.kind === 'domain_already_exists') {
      throw new MailPolicyFailure('domain_already_exists', 'Mail policy already contains the domain')
    }
    if (result.kind === 'domain_not_found') {
      throw new MailPolicyFailure('domain_not_found', 'Mail policy domain was not found')
    }
    if (result.kind === 'policy_limit_exceeded') {
      throw new MailPolicyFailure('policy_limit_exceeded', 'Mail policy entry limit was reached')
    }
    return this.resolveReceipt(result.receipt)
  }

  private async resolveReceipt(receipt: MailPolicyCommandReceipt) {
    if (receipt.kind === 'import_failed') {
      throw new MailPolicyFailure('source_import_failed', 'Mail registry import failed closed')
    }
    if (receipt.kind === 'import_rejected') {
      throw new MailPolicyFailure('suspicious_mass_removal', 'Mail registry import was rejected as suspicious')
    }
    return this.dependencies.repository.readView(this.dependencies.clock.now())
  }
}

export function normalizeEmailDomain(value: string) {
  const ascii = domainToASCII(value.trim().replace(/\.$/, '')).toLowerCase()
  const labels = ascii.split('.')
  if (
    ascii.length < 1
    || ascii.length > 253
    || labels.length < 2
    || labels.some((label) => label.length < 1
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new MailPolicyFailure('invalid_domain', 'Mail domain is invalid')
  }
  return ascii
}

function fingerprintOf(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sourceFailureCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    const code = error.code.slice(0, 64)
    if (/^[a-z0-9_]+$/.test(code)) return code
  }
  return 'source_unavailable'
}
