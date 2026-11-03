import type { GameMode, TutorialLessonsProgress, TutorialProgressCommand } from '@anomaly-detector/contracts'

export type CompletedMatchPlayer = {
  placement?: number
  budget: number
  correctTheses: number
  forfeitedAt?: string
  playerId: string
  rating: number
}

export type CompletedProfileMatch = {
  mode?: GameMode
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
  complete(userId: string, completedAt: Date): Promise<Date | null>
  read(userId: string): Promise<Date | null>
  readLessons(userId: string): Promise<TutorialLessonsProgress | null>
  recordLesson(userId: string, command: TutorialProgressCommand, completedAt: Date): Promise<TutorialLessonsProgress | null>
}
