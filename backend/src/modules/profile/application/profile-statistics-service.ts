import type { ProfileStatistics } from '@anomaly-detector/contracts'

import type {
  CompletedMatchPlayer,
  CompletedProfileMatch,
  ProfileStatisticsRepository,
} from './ports'

const modelPropertiesPerMatch = 12

export class ProfileStatisticsService {
  private readonly dependencies: {
    repository: ProfileStatisticsRepository
  }

  constructor(dependencies: { repository: ProfileStatisticsRepository }) {
    this.dependencies = dependencies
  }

  async read(userId: string): Promise<ProfileStatistics> {
    const matches = await this.dependencies.repository.listCompletedMatches(userId)
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
    const ratings = matches.map((match) => playerFor(match, userId).rating)
    const wins = matches.filter((match) => match.winnerPlayerIds.includes(userId)).length
    const submittedContracts = sum(matches.map((match) => match.playerResult.submittedContracts))
    const successfulContracts = sum(matches.map((match) => match.playerResult.successfulContracts))
    const correctModelProperties = sum(matches.map((match) => match.playerResult.correctModelProperties))

    return {
      averagePlacement: average(placements),
      averageRating: average(ratings),
      contractSuccessRate: submittedContracts === 0 ? null : successfulContracts / submittedContracts,
      matchesPlayed: matches.length,
      modelAccuracy: correctModelProperties / (matches.length * modelPropertiesPerMatch),
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
