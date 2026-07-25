export type CompletedMatchPlayer = {
  budget: number
  correctTheses: number
  playerId: string
  rating: number
}

export type CompletedProfileMatch = {
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
