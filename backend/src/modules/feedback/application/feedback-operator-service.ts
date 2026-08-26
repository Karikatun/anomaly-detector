import { createHmac } from 'node:crypto'

import type {
  FeedbackDeleteContactCommand,
  FeedbackRecordGithubIssueCommand,
  FeedbackRejectCommand,
  FeedbackResolveCommand,
  FeedbackTakeCommand,
} from '@anomaly-detector/contracts'

import { FeedbackFailure } from '../domain/errors'
import type {
  FeedbackOperatorCommitResult,
  FeedbackOperatorContext,
  FeedbackOperatorRepository,
  StoredFeedbackOperatorCommand,
} from './ports'

export class FeedbackOperatorService {
  constructor(private readonly dependencies: {
    clock: { now(): Date }
    fingerprintKey: string
    repository: FeedbackOperatorRepository
  }) {}

  read(query: Parameters<FeedbackOperatorRepository['read']>[0]) {
    return this.dependencies.repository.read(query)
  }

  deleteContact(
    command: FeedbackDeleteContactCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ) {
    return this.execute('delete-contact', command, operator, reportId, (fingerprint, now) =>
      this.dependencies.repository.deleteContact({
        actorId: operator.id,
        ...command,
        fingerprint,
        now,
        reportId,
      }))
  }

  recordGithubIssue(
    command: FeedbackRecordGithubIssueCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ) {
    return this.execute('record-github-issue', command, operator, reportId, (fingerprint, now) =>
      this.dependencies.repository.recordGithubIssue({
        actorId: operator.id,
        ...command,
        fingerprint,
        now,
        reportId,
      }))
  }

  reject(
    command: FeedbackRejectCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ) {
    const normalized = { ...command, reason: command.reason.trim() }
    return this.execute('reject', normalized, operator, reportId, (fingerprint, now) =>
      this.dependencies.repository.reject({
        actorId: operator.id,
        ...normalized,
        fingerprint,
        now,
        reportId,
      }))
  }

  resolve(
    command: FeedbackResolveCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ) {
    return this.execute('resolve', command, operator, reportId, (fingerprint, now) =>
      this.dependencies.repository.resolve({
        actorId: operator.id,
        ...command,
        fingerprint,
        now,
        reportId,
      }))
  }

  take(
    command: FeedbackTakeCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ) {
    return this.execute('take', command, operator, reportId, (fingerprint, now) =>
      this.dependencies.repository.take({
        actorId: operator.id,
        ...command,
        fingerprint,
        now,
        reportId,
      }))
  }

  private async execute(
    type: string,
    command: { commandId: string; expectedVersion: number },
    operator: FeedbackOperatorContext,
    reportId: string,
    commit: (fingerprint: string, now: Date) => Promise<FeedbackOperatorCommitResult>,
  ) {
    const now = this.dependencies.clock.now()
    const fingerprint = fingerprintOf(
      { ...command, reportId, type },
      this.dependencies.fingerprintKey,
    )
    const existing = await this.dependencies.repository.findCommand(command.commandId)
    if (existing) return this.resolveExisting(existing, fingerprint)
    return this.resolveCommit(await commit(fingerprint, now), fingerprint)
  }

  private resolveExisting(existing: StoredFeedbackOperatorCommand, fingerprint: string) {
    if (existing.fingerprint !== fingerprint) {
      throw new FeedbackFailure(
        'command_conflict',
        'Command identifier was already used for another feedback operation',
      )
    }
    return existing.receipt
  }

  private resolveCommit(result: FeedbackOperatorCommitResult, fingerprint: string) {
    if (result.kind === 'command_exists') return this.resolveExisting(result, fingerprint)
    if (result.kind === 'report_not_found') {
      throw new FeedbackFailure('report_not_found', 'Feedback report was not found')
    }
    if (result.kind === 'version_conflict') {
      throw new FeedbackFailure('version_conflict', 'Feedback report version changed before commit')
    }
    if (result.kind === 'transition_conflict') {
      throw new FeedbackFailure('transition_conflict', 'Feedback report state does not allow this operation')
    }
    if (result.kind === 'contact_absent') {
      throw new FeedbackFailure('contact_absent', 'Feedback report has no voluntary contact to delete')
    }
    if (result.kind !== 'committed') throw new Error('Unexpected feedback commit result')
    return result.receipt
  }

}

function fingerprintOf(value: unknown, key: string) {
  return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
}
