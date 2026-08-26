export type TenderOperationalState = {
  active: number
  completed: number
  earlyFinished: number
  overdue: number
}

export type TenderOperationalStateReader = {
  read(now: Date): Promise<TenderOperationalState>
}
