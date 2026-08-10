import type { ProfileStatistics } from '@anomaly-detector/contracts'

import type {
  CompletedMatchPlayer,
  CompletedProfileMatch,
  CompletedTenderSummaryReader,
} from './ports'

const modelPropertiesPerMatch = 12

export class ProfileStatisticsService {
  private readonly dependencies: {
    completedTenderSummaryReader: CompletedTenderSummaryReader
  }

  constructor(dependencies: { completedTenderSummaryReader: CompletedTenderSummaryReader }) {
    this.dependencies = dependencies
  }

  async read(userId: string): Promise<ProfileStatistics> {
    const matches = await this.dependencies.completedTenderSummaryReader.listCompletedMatches(userId)
    if (matches.length === 0) {
      return {
        averagePlacement: null,
        averageRating: null,
        contractSuccessRate: null,
        matchesPlayed: 0,
        modelAccuracy: null,
        wins: 0,
        winRate: null,
      }
    }

    const placements = matches.map((match) => placementFor(match, userId))
    const performanceMatches = matches.filter((match) => !match.excludeFromPerformanceAverages)
    const ratings = performanceMatches.map((match) => playerFor(match, userId).rating)
    const wins = matches.filter((match) => match.winnerPlayerIds.includes(userId)).length
    const submittedContracts = sum(matches.map((match) => match.playerResult.submittedContracts))
    const successfulContracts = sum(matches.map((match) => match.playerResult.successfulContracts))
    const correctModelProperties = sum(matches.map((match) => match.playerResult.correctModelProperties))

    return {
      averagePlacement: average(placements),
      averageRating: ratings.length === 0 ? null : average(ratings),
      contractSuccessRate: submittedContracts === 0 ? null : successfulContracts / submittedContracts,
      matchesPlayed: matches.length,
      modelAccuracy: performanceMatches.length === 0
        ? null
        : correctModelProperties / (performanceMatches.length * modelPropertiesPerMatch),
      wins,
      winRate: wins / matches.length,
    }
  }
}

function placementFor(match: CompletedProfileMatch, userId: string) {
  const player = playerFor(match, userId)
  return 1 + match.players.filter((candidate) => comparePlayers(candidate, player) < 0).length
}

function playerFor(match: CompletedProfileMatch, userId: string) {
  const player = match.players.find((candidate) => candidate.playerId === userId)
  if (!player) throw new Error('Completed profile match is missing the requested player')
  return player
}

function comparePlayers(left: CompletedMatchPlayer, right: CompletedMatchPlayer) {
  if (Boolean(left.forfeitedAt) !== Boolean(right.forfeitedAt)) return left.forfeitedAt ? 1 : -1
  if (left.forfeitedAt && right.forfeitedAt) {
    return Date.parse(right.forfeitedAt) - Date.parse(left.forfeitedAt)
  }
  return right.rating - left.rating
    || right.correctTheses - left.correctTheses
    || right.budget - left.budget
}

function average(values: number[]) {
  return sum(values) / values.length
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}
