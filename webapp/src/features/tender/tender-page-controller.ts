export type VersionedCommandError = { message: string; version: number }

export function createExclusiveActionGate() {
  let active: Promise<void> | null = null
  return {
    run(action: () => Promise<void>, callbacks: { onFinish(): void; onStart(): void }) {
      if (active) return active
      callbacks.onStart()
      const promise = action().finally(() => {
        if (active === promise) {
          active = null
          callbacks.onFinish()
        }
      })
      active = promise
      return promise
    },
  }
}

export const shouldResumeTender = (input: {
  connected: boolean
  hasLeft: boolean
  leavingTenderId: string | null
  resumingTenderId: string | null
  tenderId: string
}) => input.connected
  && input.hasLeft
  && input.leavingTenderId !== input.tenderId
  && input.resumingTenderId !== input.tenderId

export const sequentialTurnKey = (
  phase: string,
  activePlayerId: string | undefined,
  sequentialPhases: ReadonlySet<string>,
) => sequentialPhases.has(phase) ? `${phase}:${activePlayerId ?? ''}` : undefined

export const shouldFocusSequentialTurn = (input: {
  activePlayerId?: string
  currentUserId?: string
  currentTurnKey?: string
  previousTurnKey?: string
}) => input.previousTurnKey !== undefined
  && input.currentTurnKey !== undefined
  && input.previousTurnKey !== input.currentTurnKey
  && input.activePlayerId === input.currentUserId

export const visibleCommandError = (
  commandError: VersionedCommandError | null,
  viewVersion: number,
) => commandError?.version === viewVersion ? commandError.message : null
