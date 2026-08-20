const storageKey = 'anomaly-detector:post-auth-continuation'
const tutorialIntent = 'tutorial' as const

export type PostAuthContinuation = typeof tutorialIntent

export function capturePostAuthContinuation(
  storage: Storage,
  url: URL,
): PostAuthContinuation | null {
  const requested = url.searchParams.get('continue')
  if (requested === null) return peekPostAuthContinuation(storage)
  if (requested === tutorialIntent) {
    storage.setItem(storageKey, tutorialIntent)
    return tutorialIntent
  }
  storage.removeItem(storageKey)
  return null
}

export function peekPostAuthContinuation(storage: Storage): PostAuthContinuation | null {
  const stored = storage.getItem(storageKey)
  if (stored === tutorialIntent) return stored
  if (stored !== null) storage.removeItem(storageKey)
  return null
}

export function consumePostAuthContinuation(storage: Storage): '/tutorial' | null {
  const continuation = peekPostAuthContinuation(storage)
  storage.removeItem(storageKey)
  return continuation === tutorialIntent ? '/tutorial' : null
}
