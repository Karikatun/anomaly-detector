import type { TenderView } from '@anomaly-detector/contracts'

type CompletedTenderSource = Pick<TenderView, 'players' | 'publicTheses' | 'winnerPlayerIds'> & {
  audit: Pick<NonNullable<TenderView['audit']>,
    'completionReason' | 'placementByPlayer' | 'privateThesesByPlayer' | 'ratingBreakdownByPlayer' | 'ruleset'>
}

const completionReasonKeys = {
  standard: 'tender.completedTenderPanel.copy.019',
  all_players_left: 'tender.completedTenderPanel.copy.020',
  last_active_player: 'tender.completedTenderPanel.copy.021',
  all_players_forfeited: 'tender.completedTenderPanel.copy.022',
} as const

const ratingKeys = [
  'completeModelBonus',
  'contractPoints',
  'correctPropertyPoints',
  'correctSignalPoints',
  'otherPoints',
  'thesisPoints',
] as const

const correctThesisCount = (view: CompletedTenderSource, playerId: string) =>
  view.audit.ruleset === 'tender-v2'
    ? new Set(
        (view.audit.privateThesesByPlayer[playerId] ?? [])
          .filter((thesis) => thesis.fullyCorrect)
          .map((thesis) => thesis.signalId),
      ).size
    : view.publicTheses.filter((thesis) => thesis.playerId === playerId && thesis.correct).length

export function tenderPointUnit(points: number) {
  const absolute = Math.abs(points)
  const lastTwoDigits = absolute % 100
  const lastDigit = absolute % 10
  return lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? 'many'
    : lastDigit === 1
      ? 'one'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'few'
        : 'many'
}

export function presentCompletedTender(view: CompletedTenderSource, currentUserId?: string) {
  const winnerIds = new Set(view.winnerPlayerIds ?? [])
  const rankedPlayers = view.players.slice().sort((left, right) =>
    (view.audit.placementByPlayer[left.playerId] ?? 99)
    - (view.audit.placementByPlayer[right.playerId] ?? 99),
  )
  const currentPlayer = rankedPlayers.find((player) => player.playerId === currentUserId)
  return {
    completionReasonKey: completionReasonKeys[view.audit.completionReason],
    currentPlayer,
    currentPlayerIsWinner: currentPlayer ? winnerIds.has(currentPlayer.playerId) : false,
    currentPlacement: currentPlayer
      ? view.audit.placementByPlayer[currentPlayer.playerId]
      : undefined,
    currentRating: currentPlayer?.rating,
    otherPlayers: rankedPlayers.filter((player) => player.playerId !== currentPlayer?.playerId),
    rankedPlayers,
    ratingEntries(playerId: string) {
      const breakdown = view.audit.ratingBreakdownByPlayer[playerId]
      return breakdown
        ? ratingKeys.map((key) => ({ key, points: breakdown[key] })).filter(({ points }) => points !== 0)
        : []
    },
    standingFactors(playerId: string) {
      const player = view.players.find((candidate) => candidate.playerId === playerId)
      return {
        corporateTrust: player?.corporateTrust ?? 0,
        correctTheses: correctThesisCount(view, playerId),
        rating: player?.rating ?? 0,
        remainingBudget: player?.budget ?? 0,
      }
    },
    winnerIds,
    winnerNames: rankedPlayers
      .filter((player) => winnerIds.has(player.playerId))
      .map((player) => player.displayName ?? player.playerId.slice(0, 8)),
  }
}
