import type {
  PublicThesis,
  TenderPlayer,
  TenderRuleset,
} from '@anomaly-detector/contracts'

import type { SignalId } from './anomaly-configuration'

type FinalResultState = {
  budgetByPlayer: Record<string, number>
  certifiedSignalsByPlayer: Record<string, SignalId[]>
  forfeitedAtByPlayer: Record<string, string>
  players: TenderPlayer[]
  publicTheses: PublicThesis[]
  ratingByPlayer: Record<string, number>
  ruleset: TenderRuleset
}

const correctThesisCount = (tender: FinalResultState, playerId: string) => tender.ruleset === 'tender-v2'
  ? (tender.certifiedSignalsByPlayer[playerId] ?? []).length
  : tender.publicTheses.filter((thesis) => thesis.playerId === playerId && thesis.correct).length

const compareFinalPlayers = (tender: FinalResultState, left: TenderPlayer, right: TenderPlayer) => {
  const leftForfeitedAt = tender.forfeitedAtByPlayer[left.id]
  const rightForfeitedAt = tender.forfeitedAtByPlayer[right.id]
  if (Boolean(leftForfeitedAt) !== Boolean(rightForfeitedAt)) return leftForfeitedAt ? 1 : -1
  if (leftForfeitedAt && rightForfeitedAt) {
    return Date.parse(rightForfeitedAt) - Date.parse(leftForfeitedAt)
  }
  return (tender.ratingByPlayer[right.id] ?? 0) - (tender.ratingByPlayer[left.id] ?? 0)
    || correctThesisCount(tender, right.id) - correctThesisCount(tender, left.id)
    || (tender.budgetByPlayer[right.id] ?? 0) - (tender.budgetByPlayer[left.id] ?? 0)
}

export const createPlacementByPlayer = (tender: FinalResultState) => Object.fromEntries(
  tender.players.map((player) => [
    player.id,
    1 + tender.players.filter((candidate) => compareFinalPlayers(tender, candidate, player) < 0).length,
  ]),
)

export const resolveWinnerPlayerIds = (tender: FinalResultState) => {
  const eligiblePlayers = tender.players.filter((player) => tender.forfeitedAtByPlayer[player.id] === undefined)
  if (eligiblePlayers.length === 0) return []
  const highestRating = Math.max(...eligiblePlayers.map((player) => tender.ratingByPlayer[player.id] ?? 0))
  const ratingLeaders = eligiblePlayers.filter((player) => (tender.ratingByPlayer[player.id] ?? 0) === highestRating)
  const highestThesisCount = Math.max(...ratingLeaders.map((player) => correctThesisCount(tender, player.id)))
  const thesisLeaders = ratingLeaders.filter((player) => correctThesisCount(tender, player.id) === highestThesisCount)
  const highestBudget = Math.max(...thesisLeaders.map((player) => tender.budgetByPlayer[player.id] ?? 0))
  return thesisLeaders
    .filter((player) => (tender.budgetByPlayer[player.id] ?? 0) === highestBudget)
    .map((player) => player.id)
}
