import type { TutorialLessonsProgress } from '@anomaly-detector/contracts'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

export function createTutorialProgressCacheWriter(client: QueryClient, key: QueryKey) {
  const generation = () => client.getQueryCache().find({ queryKey: key, exact: true })
  return {
    onMutate: generation,
    onSuccess: (progress: TutorialLessonsProgress, _command: unknown, startedIn: ReturnType<typeof generation>) => {
      // Session erasure removes this Query. A callback already queued by a
      // resolved request must not recreate it or write into the next account.
      if (!startedIn || generation() !== startedIn) return
      client.setQueryData<TutorialLessonsProgress>(key, (current) => mergeTutorialLessonsProgress(current, progress))
    },
  }
}

// These server facts are append-only within an account. Auth/session erasure clears
// the query cache separately; this merge never reads another account or storage.
export function mergeTutorialLessonsProgress(current: TutorialLessonsProgress | undefined, incoming: TutorialLessonsProgress): TutorialLessonsProgress {
  if (!current) return incoming
  return {
    schemaVersion: 1,
    base: {
      legacyCredit: current.base.legacyCredit?.completedAt ? current.base.legacyCredit : incoming.base.legacyCredit ?? current.base.legacyCredit,
      completion: current.base.completion ?? incoming.base.completion,
    },
    additional: { completion: current.additional.completion ?? incoming.additional.completion },
  }
}
