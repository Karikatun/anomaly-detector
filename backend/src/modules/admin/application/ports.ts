import type {
  AdminOverview,
  AdminOverviewQuery,
  MailPolicyImportCommand,
  MailPolicyPublishCommand,
  MailPolicyStatusCommand,
  MailPolicyView,
} from '@anomaly-detector/contracts'

export type AdminOverviewReader = {
  read(query: AdminOverviewQuery): Promise<AdminOverview>
}

type AdminOperator = {
  authenticatedAt: Date
  id: string
}

export type AdminMailPolicyOperator = {
  changeStatus(command: MailPolicyStatusCommand, operator: AdminOperator): Promise<MailPolicyView>
  importCandidates(command: MailPolicyImportCommand, operator: AdminOperator): Promise<MailPolicyView>
  publish(command: MailPolicyPublishCommand, operator: AdminOperator): Promise<MailPolicyView>
  read(): Promise<MailPolicyView>
}
