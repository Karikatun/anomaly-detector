import type {
  AnalyticsAdminOverview,
  AnalyticsAdminQuery,
  AdminOverview,
  AdminOverviewQuery,
  FeedbackDeleteContactCommand,
  FeedbackOperatorCommandResponse,
  FeedbackQueueQuery,
  FeedbackQueueResponse,
  FeedbackRecordGithubIssueCommand,
  FeedbackRejectCommand,
  FeedbackResolveCommand,
  FeedbackTakeCommand,
  MailPolicySyncCommand,
  MailPolicyStatusCommand,
  MailOperationsView,
  RequestBudgetOverview,
} from '@anomaly-detector/contracts'

export type AdminAnalyticsReader = {
  read(query: AnalyticsAdminQuery): Promise<AnalyticsAdminOverview>
}

export type AdminOverviewReader = {
  read(query: AdminOverviewQuery): Promise<AdminOverview>
}

export type AdminRequestBudgetOverviewReader = {
  read(now: Date): Promise<RequestBudgetOverview>
}

type AdminOperator = {
  authenticatedAt: Date
  id: string
}

export type AdminMailPolicyOperator = {
  changeStatus(command: MailPolicyStatusCommand, operator: AdminOperator): Promise<MailOperationsView>
  read(): Promise<MailOperationsView>
  syncCatalog(command: MailPolicySyncCommand, operator: AdminOperator): Promise<MailOperationsView>
}

export type AdminFeedbackOperator = {
  deleteContact(command: FeedbackDeleteContactCommand, operator: AdminOperator, reportId: string): Promise<FeedbackOperatorCommandResponse>
  read(query: FeedbackQueueQuery): Promise<FeedbackQueueResponse>
  recordGithubIssue(command: FeedbackRecordGithubIssueCommand, operator: AdminOperator, reportId: string): Promise<FeedbackOperatorCommandResponse>
  reject(command: FeedbackRejectCommand, operator: AdminOperator, reportId: string): Promise<FeedbackOperatorCommandResponse>
  resolve(command: FeedbackResolveCommand, operator: AdminOperator, reportId: string): Promise<FeedbackOperatorCommandResponse>
  take(command: FeedbackTakeCommand, operator: AdminOperator, reportId: string): Promise<FeedbackOperatorCommandResponse>
}
