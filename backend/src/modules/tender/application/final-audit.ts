import type { RatingBreakdown } from '@anomaly-detector/contracts'

import type { SignalId } from '../domain/anomaly-configuration'
import { createFinalStandingByPlayer } from '../domain/final-results'
import type { StoredTender, StoredTenderAuditEvent } from './tender-store'

export const createRatingBreakdownByPlayer = (
  tender: StoredTender,
  events: StoredTenderAuditEvent[],
): Record<string, RatingBreakdown> => {
  const breakdownByPlayer = Object.fromEntries(tender.players.map((player) => [
    player.id,
    {
      completeModelBonus: 0,
      contractPoints: 0,
      correctPropertyPoints: 0,
      correctSignalPoints: 0,
      otherPoints: 0,
      thesisPoints: 0,
      total: 0,
    },
  ])) as Record<string, RatingBreakdown>

  for (const event of events) {
    const playerIdValue = (event.payload as Record<string, unknown>).playerId
    const playerId = typeof playerIdValue === 'string' ? playerIdValue : undefined
    if (!playerId) continue
    const breakdown = breakdownByPlayer[playerId]
    if (!breakdown) continue

    if (event.kind === 'thesis_checked' && event.payload.correct === true) {
      breakdown.thesisPoints += 1
    }
    if (event.kind === 'private_thesis_checked' && event.payload.ratingAward === 1) {
      breakdown.thesisPoints += 1
    }
    if (event.kind === 'contract_bid_assessed' && event.payload.awarded === true) {
      const recordedAward = event.payload.ratingAward
      if (typeof recordedAward === 'number' && Number.isInteger(recordedAward)) {
        breakdown.contractPoints += recordedAward
      } else {
        const ratingByPlayer = event.payload.ratingByPlayer
        const recordedTotal = typeof ratingByPlayer === 'object' && ratingByPlayer !== null
          ? (ratingByPlayer as Record<string, unknown>)[playerId]
          : undefined
        if (typeof recordedTotal === 'number' && Number.isInteger(recordedTotal)) {
          breakdown.contractPoints += recordedTotal
            - breakdown.thesisPoints
            - breakdown.contractPoints
        }
      }
    }
    if (event.kind === 'scientific_model_scored') {
      const completeModelBonus = event.payload.completeModelBonus
      const correctProperties = event.payload.correctProperties
      const correctSignals = event.payload.correctSignals
      if (typeof completeModelBonus === 'number' && Number.isInteger(completeModelBonus)) {
        breakdown.completeModelBonus += completeModelBonus
      }
      if (typeof correctProperties === 'number' && Number.isInteger(correctProperties)) {
        breakdown.correctPropertyPoints += correctProperties
      }
      if (typeof correctSignals === 'number' && Number.isInteger(correctSignals)) {
        breakdown.correctSignalPoints += correctSignals
      }
    }
  }

  const finalStandingByPlayer = createFinalStandingByPlayer(tender)
  for (const player of tender.players) {
    const breakdown = breakdownByPlayer[player.id]
    breakdown.thesisPoints = finalStandingByPlayer[player.id]?.correctTheses ?? 0
    const knownPoints = breakdown.completeModelBonus
      + breakdown.contractPoints
      + breakdown.correctPropertyPoints
      + breakdown.correctSignalPoints
      + breakdown.thesisPoints
    breakdown.otherPoints = (tender.ratingByPlayer[player.id] ?? 0) - knownPoints
    breakdown.total = knownPoints + breakdown.otherPoints
  }

  return breakdownByPlayer
}

export const createFinalScientificModelAuditByPlayer = (tender: StoredTender) => Object.fromEntries(
  tender.players.map((player) => {
    const model = tender.finalScientificModelsByPlayer[player.id]
    if (!model) return [player.id, { signals: {}, submitted: false }]
    return [player.id, {
      signals: Object.fromEntries(Object.entries(model.signals).map(([signalId, claim]) => {
        const actual = tender.anomalyConfiguration.signals[signalId as SignalId]
        return [signalId, {
          ...(claim.fieldType
            ? { fieldType: claim.fieldType, fieldTypeCorrect: claim.fieldType === actual.fieldType }
            : {}),
          ...(claim.polarity
            ? { polarity: claim.polarity, polarityCorrect: claim.polarity === actual.polarity }
            : {}),
        }]
      })),
      submitted: true,
    }]
  }),
)
