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

export type CompletedTenderSummaryReader = {
  listCompletedMatches(userId: string): Promise<CompletedProfileMatch[]>
}

export type TutorialProgressRepository = {
  complete(userId: string, completedAt: Date): Promise<Date>
  read(userId: string): Promise<Date | null>
}
