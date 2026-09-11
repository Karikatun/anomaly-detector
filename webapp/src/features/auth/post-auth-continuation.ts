const storageKey = 'anomaly-detector:post-auth-continuation'
const tutorialIntents = ['tutorial', 'tutorial-complete'] as const

export type PostAuthContinuation = typeof tutorialIntents[number]

function isTutorialIntent(value: string | null): value is PostAuthContinuation {
  return tutorialIntents.some((intent) => intent === value)
}

export function capturePostAuthContinuation(
  storage: Storage,
  url: URL,
): PostAuthContinuation | null {
  const requested = url.searchParams.get('continue')
  if (requested === null) return peekPostAuthContinuation(storage)
  if (isTutorialIntent(requested)) {
    storage.setItem(storageKey, requested)
    return requested
  }
  storage.removeItem(storageKey)
  return null
}

export function peekPostAuthContinuation(storage: Storage): PostAuthContinuation | null {
  const stored = storage.getItem(storageKey)
  if (isTutorialIntent(stored)) return stored
  if (stored !== null) storage.removeItem(storageKey)
  return null
}

export function consumePostAuthContinuation(storage: Storage): '/tutorial' | null {
  const continuation = peekPostAuthContinuation(storage)
  storage.removeItem(storageKey)
  return continuation ? '/tutorial' : null
}
