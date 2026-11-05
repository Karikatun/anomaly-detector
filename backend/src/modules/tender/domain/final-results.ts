import type {
  PublicThesis,
  GameDescriptor,
  ScientificModel,
  TenderPlayer,
  TenderRuleset,
} from '@anomaly-detector/contracts'

import type { SignalId } from './anomaly-configuration'

type FinalResultState = {
  completionReason?: string
  finalScientificModelsByPlayer?: Record<string, ScientificModel>
  game?: GameDescriptor
  finalSubmissionOrderByPlayer?: Record<string, number>
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
  tender: FinalResultState,
  standings: FinalStandingByPlayer,
  leftPlayerId: string,
  rightPlayerId: string,
) => standings[rightPlayerId]!.rating - standings[leftPlayerId]!.rating
  || (tender.game?.mode === 'simple' ? 0 : standings[rightPlayerId]!.correctTheses - standings[leftPlayerId]!.correctTheses)
  || standings[rightPlayerId]!.remainingBudget - standings[leftPlayerId]!.remainingBudget
  || (tender.game?.mode === 'simple' ? (tender.finalSubmissionOrderByPlayer?.[leftPlayerId] ?? Number.MAX_SAFE_INTEGER) - (tender.finalSubmissionOrderByPlayer?.[rightPlayerId] ?? Number.MAX_SAFE_INTEGER) : 0)

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
  if (tender.game?.mode === 'simple' && tender.completionReason === undefined) {
    const leftSubmitted = tender.finalScientificModelsByPlayer?.[left.id] !== undefined
    const rightSubmitted = tender.finalScientificModelsByPlayer?.[right.id] !== undefined
    if (leftSubmitted !== rightSubmitted) return leftSubmitted ? -1 : 1
    if (!leftSubmitted) return 0
  }
  return compareRankedStandings(tender, standings, left.id, right.id)
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
  const eligiblePlayers = tender.players.filter((player) => tender.forfeitedAtByPlayer[player.id] === undefined
    && (tender.game?.mode !== 'simple' || tender.completionReason !== undefined || tender.finalScientificModelsByPlayer?.[player.id] !== undefined))
  if (eligiblePlayers.length === 0) return []
  const standings = createFinalStandingByPlayer(tender)
  const leader = eligiblePlayers.reduce((currentLeader, candidate) =>
    compareRankedStandings(tender, standings, candidate.id, currentLeader.id) < 0
      ? candidate
      : currentLeader,
  )
  return eligiblePlayers
    .filter((player) => compareRankedStandings(tender, standings, player.id, leader.id) === 0)
    .map((player) => player.id)
}
