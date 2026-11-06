import { useLayoutEffect, useRef, useState } from 'react'
import type { AdditionalTutorialState } from './additional-scenario'
import type { TutorialState } from './scenario'
import { getTutorialStorage, saveTutorialSession, tutorialHistoryLimit, type TutorialTimeline } from './session'

type LessonState = TutorialState | AdditionalTutorialState
type Transition = 'advance' | 'reset' | 'retreat' | 'edit'

export function useTutorialTimeline<T extends LessonState>(initialState: T, initialTimeline: TutorialTimeline<T> | null) {
  const [storage] = useState(getTutorialStorage)
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [run, setRun] = useState(() => ({ state: initialState, entry: initialTimeline?.entry ?? initialState, history: initialTimeline?.history ?? [] }))
  const current = useRef(run)
  const mounted = useRef(false)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const persist = (state: T, entry: T, history: T[]) => {
    current.current = { state, entry, history }
    setRun(current.current)
    if (!saveTutorialSession(storage, state, { entry, history })) setStorageUnavailable(true)
  }

  const commit = (next: T, transition: Transition = 'advance') => {
    const { state, entry, history } = current.current
    if (next === state) return
    if (next.step === 'complete' || next.finalSubmission !== null) {
      persist(next, next, [])
    } else if (transition === 'reset' || transition === 'retreat') {
      const index = history.findLastIndex((prior) => prior.step === next.step)
      persist(next, next, index >= 0 ? history.slice(0, index) : history)
    } else if (transition === 'edit' || next.step === state.step) {
      // A reversible choice, error or Journal re-open belongs to the same step.
      persist(next, entry.step === next.step ? entry : { ...entry, step: next.step }, history)
    } else {
      persist(next, next, [...history, entry].slice(-tutorialHistoryLimit))
    }
  }

  const back = (beforeRestore: (previous: T) => void) => {
    const { state, history } = current.current
    const previous = history.at(-1)
    if (state.step === 'complete' || state.finalSubmission !== null || !previous) return false
    beforeRestore(previous)
    persist(previous, previous, history.slice(0, -1))
    return true
  }

  return {
    state: run.state,
    canGoBack: run.history.length > 0 && run.state.step !== 'complete' && run.state.finalSubmission === null,
    currentState: () => current.current.state,
    commit,
    back,
    restart: (state: T) => persist(state, state, []),
    isMounted: () => mounted.current,
    storage,
    storageUnavailable,
  }
}
