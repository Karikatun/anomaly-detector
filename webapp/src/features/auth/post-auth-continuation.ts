const storageKey = 'anomaly-detector:post-auth-continuation'
const tutorialIntents = ['tutorial', 'tutorial-complete', 'tutorial-additional-complete'] as const

export type PostAuthContinuation = typeof tutorialIntents[number]

function isTutorialIntent(value: string | null): value is PostAuthContinuation {
  return tutorialIntents.some((intent) => intent === value)
}

export function capturePostAuthContinuation(
  storage: Storage | undefined,
  url: URL,
): PostAuthContinuation | null {
  const requested = url.searchParams.get('continue')
  if (requested === null) return peekPostAuthContinuation(storage)
  if (isTutorialIntent(requested)) {
    try {
      if (!storage) return null
      storage.setItem(storageKey, requested)
      return requested
    } catch { return null }
  }
  try { storage?.removeItem(storageKey) } catch { /* Navigation does not require storage. */ }
  return null
}

export function peekPostAuthContinuation(storage: Storage | undefined): PostAuthContinuation | null {
  let stored: string | null
  try { stored = storage?.getItem(storageKey) ?? null } catch { return null }
  if (isTutorialIntent(stored)) return stored
  if (stored !== null) { try { storage?.removeItem(storageKey) } catch { /* Ignore disposable invalid data. */ } }
  return null
}

export function consumePostAuthContinuation(storage: Storage | undefined): '/tutorial' | '/tutorial?lesson=additional' | null {
  const continuation = peekPostAuthContinuation(storage)
  try { storage?.removeItem(storageKey) } catch { return null }
  return continuation === 'tutorial-additional-complete' ? '/tutorial?lesson=additional' : continuation ? '/tutorial' : null
}
