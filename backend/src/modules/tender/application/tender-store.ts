import type {
  AdvanceDueTendersInput,
  CommandReceipt,
  PowerAllocation,
  PublicContract,
  PublicLaboratoryResult,
  ScientificJournalEntry,
  PublicThesis,
  PrivateThesis,
  ScientificModel,
  ScientificModelDraft,
  TenderCommand,
  TenderAuditEvent,
  TenderPhase,
  TenderPlayer,
  TenderRuleset,
  WorkingModel,
} from '@anomaly-detector/contracts'
import type { AnomalyConfiguration, SignalId } from '../domain/anomaly-configuration'

export type PrivateMeasurement = { receiverSignal: SignalId; sourceSignal: SignalId; polarityRelation: 'same' | 'different' }

export type StoredTenderCommand = {
  fingerprint: string
  receipt: CommandReceipt
}

export type PendingTenderAuditEvent = {
  actorId?: string
  commandId?: string
  kind: string
  payload: Record<string, unknown>
}

export type StoredTenderAuditEvent = TenderAuditEvent

export type StoredTender = {
  accessSlots: Record<string, number>
  abandonmentDueAt: Date | null
  anomalyConfiguration: AnomalyConfiguration
  budgetByPlayer: Record<string, number>
  corporateTrustByPlayer: Record<string, number>
  corporateReviewActive: boolean
  corporateReviewByPlayer: Record<string, boolean>
  contractCompletedByPlayer: Record<string, boolean>
  contractPowerRestrictionsByPlayer: Record<string, number>
  completionReason?: 'all_players_left'
  departedPlayerIds: string[]
  dueAt: Date | null
  id: string
  knownSignals: SignalId[]
  phase: TenderPhase
  finalScientificModelCompletedByPlayer: Record<string, boolean>
  finalScientificModelDraftsByPlayer: Record<string, ScientificModelDraft>
  finalScientificModelsByPlayer: Record<string, ScientificModel>
  powerAllocations: Record<string, PowerAllocation>
  processedCommands: Record<string, StoredTenderCommand>
  publicContracts: PublicContract[]
  publicFinalContract: PublicContract
  publicLaboratoryResults: PublicLaboratoryResult[]
  publicScientificJournal: ScientificJournalEntry[]
  publicTheses: PublicThesis[]
  ratingByPlayer: Record<string, number>
  ruleset: TenderRuleset
  round: number
  requestedSlots: Record<string, number>
  rawTelemetrySignalsByPlayer: Record<string, SignalId[]>
  reconnaissanceCompletedByPlayer: Record<string, boolean>
  laboratoryCompletedByPlayer: Record<string, boolean>
  modelAnalysisCompletedByPlayer: Record<string, boolean>
  privateMeasurementsByPlayer: Record<string, PrivateMeasurement[]>
  privateThesesByPlayer: Record<string, PrivateThesis[]>
  certifiedSignalsByPlayer: Record<string, SignalId[]>
  researchCertificationsByPlayer: Record<string, SignalId[]>
  usedContractEvidenceTestIds: string[]
  privateWorkingModelsByPlayer: Record<string, WorkingModel>
  samplesByPlayer: Record<string, SignalId[]>
  players: TenderPlayer[]
  version: number
  winnerPlayerIds: string[]
}

export type TenderCommit = {
  auditEvents: PendingTenderAuditEvent[]
  command?: StoredTenderCommand
  commandId?: string
  expectedVersion: number
  nextTender: StoredTender
  tenderId: string
}

export type TenderCommitResult =
  | { kind: 'committed' }
  | { command: StoredTenderCommand; kind: 'command_exists' }
  | { kind: 'version_conflict' }

export type TenderStore = {
  anonymizeParticipant(playerId: string): Promise<string[]>
  commit(change: TenderCommit): Promise<TenderCommitResult>
  create(tender: Omit<StoredTender, 'id'>): Promise<StoredTender>
  findDue(input: AdvanceDueTendersInput): Promise<string[]>
  readAuditEvents(tenderId: string): Promise<StoredTenderAuditEvent[]>
  read(tenderId: string): Promise<StoredTender | null>
}
