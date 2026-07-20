import type {
  AdvanceDueTendersInput,
  CommandReceipt,
  PowerAllocation,
  TenderCommand,
  TenderPhase,
  TenderPlayer,
} from '@the-game/contracts'
import type { AnomalyConfiguration, SignalId } from '../domain/anomaly-configuration'

export type PrivateMeasurement = { receiverSignal: SignalId; sourceSignal: SignalId; polarityRelation: 'same' | 'different' }

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
  rawTelemetrySignalsByPlayer: Record<string, SignalId[]>
  reconnaissanceCompletedByPlayer: Record<string, boolean>
  laboratoryCompletedByPlayer: Record<string, boolean>
  modelAnalysisCompletedByPlayer: Record<string, boolean>
  privateMeasurementsByPlayer: Record<string, PrivateMeasurement[]>
  samplesByPlayer: Record<string, SignalId[]>
  players: TenderPlayer[]
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
