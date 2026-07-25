import type { SignalId } from '@anomaly-detector/contracts'

const accents: Record<SignalId, string> = {
  aster: '#2ea8ff',
  boreal: '#bd64f4',
  cinder: '#ff6a18',
  delta: '#78d835',
  eclipse: '#b75bea',
  ferro: '#21d4dc',
}

export function signalAccent(signal: SignalId) {
  return accents[signal]
}
