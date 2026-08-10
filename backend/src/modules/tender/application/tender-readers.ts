import { TenderFailure } from '../domain/errors'
import type { StoredTender, StoredTenderAuditEvent, TenderStore } from './tender-store'

export type CompletedTenderSummaryPlayer = {
  budget: number
  correctTheses: number
  forfeitedAt?: string
  playerId: string
  rating: number
}

export type CompletedTenderSummary = {
  excludeFromPerformanceAverages: boolean
  players: CompletedTenderSummaryPlayer[]
  playerResult: {
    correctModelProperties: number
    submittedContracts: number
    successfulContracts: number
  }
  winnerPlayerIds: string[]
}

export type TenderLifecycle = {
  completionReason?: 'all_players_forfeited' | 'all_players_left' | 'last_active_player'
  forfeited: boolean
  phase: StoredTender['phase']
  ruleset: StoredTender['ruleset']
}

export function createCompletedTenderSummaryReader(store: TenderStore) {
  return {
    async listCompletedForPlayer(playerId: string): Promise<CompletedTenderSummary[]> {
      const summaries: CompletedTenderSummary[] = []
      for (const tender of await store.listCompletedForPlayer(playerId)) {
        const auditEvents = await store.readAuditEvents(tender.id)
        summaries.push(toCompletedTenderSummary(tender, auditEvents, playerId))
      }
      return summaries
    },
  }
}

export function createTenderLifecycleReader(store: TenderStore) {
  return {
    async readLifecycle(input: { playerId: string; tenderId: string }): Promise<TenderLifecycle> {
      const tender = await store.read(input.tenderId)
      if (!tender) {
        throw new TenderFailure('tender_not_found', `Tender ${input.tenderId} does not exist`)
      }
      return {
        ...(tender.completionReason ? { completionReason: tender.completionReason } : {}),
        forfeited: tender.forfeitedAtByPlayer[input.playerId] !== undefined,
        phase: tender.phase,
        ruleset: tender.ruleset,
      }
    },
  }
}

function toCompletedTenderSummary(
  tender: StoredTender,
  events: StoredTenderAuditEvent[],
  requestedPlayerId: string,
): CompletedTenderSummary {
  const playerIds = new Set(tender.players.map((player) => player.id))
  if (
    tender.phase !== 'complete'
    || playerIds.size !== tender.players.length
    || !playerIds.has(requestedPlayerId)
    || !tender.players.every((player) => tender.budgetByPlayer[player.id] !== undefined)
    || (tender.winnerPlayerIds.length === 0 && tender.completionReason !== 'all_players_forfeited')
    || !tender.winnerPlayerIds.every((playerId) => playerIds.has(playerId))
    || !tender.publicTheses.every((thesis) => playerIds.has(thesis.playerId))
  ) {
    throw new TenderSummaryProjectionError(tender.id)
  }

  let correctModelProperties = 0
  let submittedContracts = 0
  let successfulContracts = 0
  for (const event of events) {
    const eventPlayerId = stringPayload(event, 'playerId')
    if (eventPlayerId && !playerIds.has(eventPlayerId)) {
      throw new TenderSummaryProjectionError(tender.id)
    }
    if (eventPlayerId !== requestedPlayerId) continue
    if (event.kind === 'scientific_model_scored') {
      correctModelProperties += integerPayload(event, 'correctProperties') ?? 0
    }
    if (event.kind === 'contract_bid_assessed') {
      submittedContracts += 1
      successfulContracts += Number(booleanPayload(event, 'awarded') === true)
    }
  }

  return {
    excludeFromPerformanceAverages: tender.completionReason === 'last_active_player'
      || tender.completionReason === 'all_players_forfeited',
    players: tender.players.map((player) => ({
      budget: tender.budgetByPlayer[player.id] ?? 0,
      correctTheses: tender.ruleset === 'tender-v2'
        ? (tender.certifiedSignalsByPlayer[player.id] ?? []).length
        : tender.publicTheses.filter((thesis) => thesis.playerId === player.id && thesis.correct).length,
      ...(tender.forfeitedAtByPlayer[player.id]
        ? { forfeitedAt: tender.forfeitedAtByPlayer[player.id] }
        : {}),
      playerId: player.id,
      rating: tender.ratingByPlayer[player.id] ?? 0,
    })),
    playerResult: {
      correctModelProperties,
      submittedContracts,
      successfulContracts,
    },
    winnerPlayerIds: tender.winnerPlayerIds,
  }
}

class TenderSummaryProjectionError extends Error {
  constructor(tenderId: string) {
    super(`Completed Tender ${tenderId} is incompatible with the profile summary projection`)
    this.name = 'TenderSummaryProjectionError'
  }
}

function payloadValue(event: StoredTenderAuditEvent, key: string) {
  return (event.payload as Record<string, unknown>)[key]
}

function stringPayload(event: StoredTenderAuditEvent, key: string) {
  const value = payloadValue(event, key)
  return typeof value === 'string' ? value : undefined
}

function integerPayload(event: StoredTenderAuditEvent, key: string) {
  const value = payloadValue(event, key)
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function booleanPayload(event: StoredTenderAuditEvent, key: string) {
  const value = payloadValue(event, key)
  return typeof value === 'boolean' ? value : undefined
}
