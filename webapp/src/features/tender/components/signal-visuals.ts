import type { SignalId } from '@anomaly-detector/contracts'

const accents: Record<SignalId, string> = {
  aster: '#2ea8ff',
  boreal: '#bd64f4',
  cinder: '#ff6a18',
  delta: '#78d835',
  eclipse: '#b75bea',
  ferro: '#21d4dc',
}

export const contractKindAccents = {
  light: '#38bdf8',
  complex: '#f29a38',
  scientific: '#bd72f4',
  final: '#f3bd42',
} as const

export function signalAccent(signal: SignalId) {
  return accents[signal]
}
