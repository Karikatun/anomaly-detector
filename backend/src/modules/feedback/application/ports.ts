import type {
  FeedbackDeleteContactCommand,
  FeedbackIntakeRequest,
  FeedbackOperatorCommandResponse,
  FeedbackQueueQuery,
  FeedbackQueueResponse,
  FeedbackRecordGithubIssueCommand,
  FeedbackRejectCommand,
  FeedbackReceipt,
  FeedbackResolveCommand,
  FeedbackTakeCommand,
} from '@anomaly-detector/contracts'

export type FeedbackIntakeOutcome =
  | { kind: 'accepted'; receipt: FeedbackReceipt }
  | { kind: 'rate_limited'; retryAfterSeconds: number }

export type FeedbackIntake = {
  submit(input: {
    clientAddress: string
    report: FeedbackIntakeRequest
    userId: string
  }): Promise<FeedbackIntakeOutcome>
}

export type FeedbackOperator = {
  deleteContact(
    command: FeedbackDeleteContactCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ): Promise<FeedbackOperatorCommandResponse>
  read(query: FeedbackQueueQuery): Promise<FeedbackQueueResponse>
  recordGithubIssue(
    command: FeedbackRecordGithubIssueCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ): Promise<FeedbackOperatorCommandResponse>
  reject(
    command: FeedbackRejectCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ): Promise<FeedbackOperatorCommandResponse>
  resolve(
    command: FeedbackResolveCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ): Promise<FeedbackOperatorCommandResponse>
  take(
    command: FeedbackTakeCommand,
    operator: FeedbackOperatorContext,
    reportId: string,
  ): Promise<FeedbackOperatorCommandResponse>
}

export type FeedbackOperatorContext = {
  id: string
}

export type StoredFeedbackOperatorCommand = {
  fingerprint: string
  receipt: FeedbackOperatorCommandResponse
}

export type FeedbackOperatorCommitResult =
  | ({ kind: 'command_exists' } & StoredFeedbackOperatorCommand)
  | { kind: 'committed'; receipt: FeedbackOperatorCommandResponse }
  | { kind: 'contact_absent' | 'report_not_found' | 'transition_conflict' | 'version_conflict' }

export type FeedbackOperatorRepository = {
  deleteContact(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
    now: Date
    reportId: string
  }): Promise<FeedbackOperatorCommitResult>
  findCommand(commandId: string): Promise<StoredFeedbackOperatorCommand | null>
  read(query: FeedbackQueueQuery): Promise<FeedbackQueueResponse>
  recordGithubIssue(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
    githubIssueNumber: number
    now: Date
    reportId: string
  }): Promise<FeedbackOperatorCommitResult>
  reject(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
    now: Date
    reason: string
    reportId: string
  }): Promise<FeedbackOperatorCommitResult>
  resolve(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
    now: Date
    reportId: string
  }): Promise<FeedbackOperatorCommitResult>
  take(input: {
    actorId: string
    commandId: string
    expectedVersion: number
    fingerprint: string
    now: Date
    reportId: string
  }): Promise<FeedbackOperatorCommitResult>
}
