import type {
  PublicThesis,
  TenderPlayer,
  TenderRuleset,
} from '@anomaly-detector/contracts'

import type { SignalId } from './anomaly-configuration'

type FinalResultState = {
  budgetByPlayer: Record<string, number>
  certifiedSignalsByPlayer: Record<string, SignalId[]>
  corporateTrustByPlayer: Record<string, number>
  forfeitedAtByPlayer: Record<string, string>
  players: TenderPlayer[]
  publicTheses: PublicThesis[]
  ratingByPlayer: Record<string, number>
  ruleset: TenderRuleset
}

const correctThesisCount = (tender: FinalResultState, playerId: string) => tender.ruleset === 'tender-v2'
  ? (tender.certifiedSignalsByPlayer[playerId] ?? []).length
  : tender.publicTheses.filter((thesis) => thesis.playerId === playerId && thesis.correct).length

export const createFinalStandingByPlayer = (tender: FinalResultState) => Object.fromEntries(
  tender.players.map((player) => [
    player.id,
    {
      corporateTrust: tender.corporateTrustByPlayer[player.id] ?? 0,
      correctTheses: correctThesisCount(tender, player.id),
      rating: tender.ratingByPlayer[player.id] ?? 0,
      remainingBudget: tender.budgetByPlayer[player.id] ?? 0,
    },
  ]),
)

type FinalStandingByPlayer = ReturnType<typeof createFinalStandingByPlayer>

const compareRankedStandings = (
  standings: FinalStandingByPlayer,
  leftPlayerId: string,
  rightPlayerId: string,
) => standings[rightPlayerId]!.rating - standings[leftPlayerId]!.rating
  || standings[rightPlayerId]!.correctTheses - standings[leftPlayerId]!.correctTheses
  || standings[rightPlayerId]!.remainingBudget - standings[leftPlayerId]!.remainingBudget

const compareFinalPlayers = (
  tender: FinalResultState,
  standings: FinalStandingByPlayer,
  left: TenderPlayer,
  right: TenderPlayer,
) => {
  const leftForfeitedAt = tender.forfeitedAtByPlayer[left.id]
  const rightForfeitedAt = tender.forfeitedAtByPlayer[right.id]
  if (Boolean(leftForfeitedAt) !== Boolean(rightForfeitedAt)) return leftForfeitedAt ? 1 : -1
  if (leftForfeitedAt && rightForfeitedAt) {
    return Date.parse(rightForfeitedAt) - Date.parse(leftForfeitedAt)
  }
  return compareRankedStandings(standings, left.id, right.id)
}

export const createPlacementByPlayer = (tender: FinalResultState) => {
  const standings = createFinalStandingByPlayer(tender)
  return Object.fromEntries(
    tender.players.map((player) => [
      player.id,
      1 + tender.players.filter((candidate) =>
        compareFinalPlayers(tender, standings, candidate, player) < 0,
      ).length,
    ]),
  )
}

export const resolveWinnerPlayerIds = (tender: FinalResultState) => {
  const eligiblePlayers = tender.players.filter((player) => tender.forfeitedAtByPlayer[player.id] === undefined)
  if (eligiblePlayers.length === 0) return []
  const standings = createFinalStandingByPlayer(tender)
  const leader = eligiblePlayers.reduce((currentLeader, candidate) =>
    compareRankedStandings(standings, candidate.id, currentLeader.id) < 0
      ? candidate
      : currentLeader,
  )
  return eligiblePlayers
    .filter((player) => compareRankedStandings(standings, player.id, leader.id) === 0)
    .map((player) => player.id)
}
