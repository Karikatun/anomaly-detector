const storageKey = 'anomaly-detector.feedback-origin-route'

export function captureFeedbackOrigin(storage: Pick<Storage, 'setItem'>, pathname: string) {
  storage.setItem(storageKey, pathname)
}

export function consumeFeedbackOrigin(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
) {
  const pathname = storage.getItem(storageKey)
  storage.removeItem(storageKey)
  return pathname
}
