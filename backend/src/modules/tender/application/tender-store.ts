import type {
  AdvanceDueTendersInput,
  CommandReceipt,
  TenderCommand,
  TenderPhase,
  TenderTeam,
} from '@the-game/contracts'
import type { AnomalyConfiguration } from '../domain/anomaly-configuration'

export type StoredTenderCommand = {
  fingerprint: string
  receipt: CommandReceipt
}

export type TenderAuditEvent = {
  actorId?: string
  commandId?: string
  kind: string
  payload: Record<string, unknown>
}

export type StoredTender = {
  accessSlots: Record<string, number>
  anomalyConfiguration: AnomalyConfiguration
  id: string
  phase: TenderPhase
  processedCommands: Record<string, StoredTenderCommand>
  requestedSlots: Record<string, number>
  teams: TenderTeam[]
  version: number
}

export type TenderCommit = {
  auditEvents: TenderAuditEvent[]
  command: StoredTenderCommand
  commandId: string
  expectedVersion: number
  nextTender: StoredTender
  tenderId: string
}

export type TenderCommitResult =
  | { kind: 'committed' }
  | { command: StoredTenderCommand; kind: 'command_exists' }
  | { kind: 'version_conflict' }

export type TenderStore = {
  commit(change: TenderCommit): Promise<TenderCommitResult>
  create(tender: Omit<StoredTender, 'id'>): Promise<StoredTender>
  findDue(input: AdvanceDueTendersInput): Promise<string[]>
  read(tenderId: string): Promise<StoredTender | null>
}
