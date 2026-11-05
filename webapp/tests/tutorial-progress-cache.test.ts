import { expect, test } from 'bun:test'
import type { TutorialLessonsProgress } from '@anomaly-detector/contracts'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { createTutorialProgressCacheWriter, mergeTutorialLessonsProgress } from '../src/features/profile/tutorial-progress-cache'

test('a late legacy-only response cannot erase actual completion in the current account cache', () => {
  const legacy: TutorialLessonsProgress = { schemaVersion: 1, base: { legacyCredit: { origin: 'legacy', completedAt: null }, completion: null }, additional: { completion: null } }
  const actual: TutorialLessonsProgress = {
    ...legacy,
    base: { ...legacy.base, completion: { origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: '2026-11-03T00:00:00.000Z' } },
    additional: { completion: { origin: 'scenario', scenarioVersion: 'additional-standard-v1', completedAt: '2026-11-03T01:00:00.000Z' } },
  }
  expect(mergeTutorialLessonsProgress(actual, legacy)).toEqual(actual)
  expect(mergeTutorialLessonsProgress(legacy, actual)).toEqual(actual)
  // Erasure/logout removes the account cache: no facts are resurrected without an existing entry.
  expect(mergeTutorialLessonsProgress(undefined, legacy)).toEqual(legacy)
})

test('a mutation callback queued before cache erasure cannot repopulate a logged-out or replacement account', async () => {
  for (const replacement of [false, true]) {
    const client = new QueryClient()
    const key = ['session', 'profile', 'tutorial-lessons', 1]
    const empty: TutorialLessonsProgress = { schemaVersion: 1, base: { legacyCredit: null, completion: null }, additional: { completion: null } }
    const completed: TutorialLessonsProgress = { ...empty, base: { ...empty.base, completion: { origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: '2026-11-03T00:00:00.000Z' } } }
    client.setQueryData(key, empty)
    let resolve!: (value: TutorialLessonsProgress) => void
    const response = new Promise<TutorialLessonsProgress>((done) => { resolve = done })
    let started!: () => void
    const didStart = new Promise<void>((done) => { started = done })
    const mutation = new MutationObserver(client, {
      mutationFn: () => { started(); return response },
      ...createTutorialProgressCacheWriter(client, key),
    })
    const pending = mutation.mutate()
    await didStart
    // The authenticated request has resolved; its queued cache callback has not run.
    resolve(completed)
    client.removeQueries({ queryKey: key, exact: true })
    if (replacement) client.setQueryData(key, empty)
    await pending
    expect(client.getQueryData(key)).toEqual(replacement ? empty : undefined)
    client.clear()
  }
})

test('the live account cache still records a successful completion', async () => {
  const client = new QueryClient()
  const key = ['session', 'profile', 'tutorial-lessons', 1]
  const empty: TutorialLessonsProgress = { schemaVersion: 1, base: { legacyCredit: null, completion: null }, additional: { completion: null } }
  const completed: TutorialLessonsProgress = { ...empty, base: { ...empty.base, completion: { origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: '2026-11-03T00:00:00.000Z' } } }
  client.setQueryData(key, empty)
  const mutation = new MutationObserver(client, { mutationFn: async () => completed, ...createTutorialProgressCacheWriter(client, key) })
  await mutation.mutate()
  expect(client.getQueryData(key)).toEqual(completed)
  client.clear()
})
