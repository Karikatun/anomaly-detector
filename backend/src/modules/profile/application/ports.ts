export type CompletedMatchPlayer = {
  budget: number
  correctTheses: number
  forfeitedAt?: string
  playerId: string
  rating: number
}

export type CompletedProfileMatch = {
  excludeFromPerformanceAverages: boolean
  players: CompletedMatchPlayer[]
  playerResult: {
    correctModelProperties: number
    submittedContracts: number
    successfulContracts: number
  }
  winnerPlayerIds: string[]
}

export type ProfileStatisticsRepository = {
  listCompletedMatches(userId: string): Promise<CompletedProfileMatch[]>
}
