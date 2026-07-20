import type {
  AdvanceDueTendersInput,
  CommandReceipt,
  PowerAllocation,
  TenderCommand,
  TenderPhase,
  TenderTeam,
} from '@the-game/contracts'
import type { AnomalyConfiguration, SignalId } from '../domain/anomaly-configuration'

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
  knownSignals: SignalId[]
  phase: TenderPhase
  powerAllocations: Record<string, PowerAllocation>
  processedCommands: Record<string, StoredTenderCommand>
  requestedSlots: Record<string, number>
  rawTelemetrySignalsByTeam: Record<string, SignalId[]>
  reconnaissanceCompletedByTeam: Record<string, boolean>
  samplesByTeam: Record<string, SignalId[]>
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
