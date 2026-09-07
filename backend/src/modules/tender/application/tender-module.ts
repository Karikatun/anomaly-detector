import type {
  AdvanceDueTendersInput,
  AdvanceDueTendersResult,
  CommandReceipt,
  CreateTender,
  TenderCommand,
  TenderView,
  TenderViewQuery,
} from '@anomaly-detector/contracts'

export type TenderModule = {
  advanceDueTenders(input: AdvanceDueTendersInput): Promise<AdvanceDueTendersResult>
  anonymizeParticipant(playerId: string): Promise<void>
  completeUnattendedBotTender(tenderId: string): Promise<boolean>
  createTender(input: CreateTender): Promise<{ tenderId: string }>
  execute(command: TenderCommand, options?: { expectedVersion: number }): Promise<CommandReceipt>
  findCommandReceipt(command: TenderCommand): Promise<CommandReceipt | undefined>
  readTenderPlacement(query: TenderViewQuery): Promise<number | undefined>
  readTenderView(query: TenderViewQuery): Promise<TenderView>
}
