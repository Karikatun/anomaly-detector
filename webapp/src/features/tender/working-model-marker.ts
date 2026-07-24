export type MarkerState = 'unset' | 'possible' | 'excluded'

export function nextMarkerState(state: MarkerState): MarkerState {
  switch (state) {
    case 'unset':
      return 'possible'
    case 'possible':
      return 'excluded'
    case 'excluded':
      return 'unset'
  }
}

export function transitionMarkerValue<T>(
  value: T,
  current: MarkerState,
  possible: readonly T[],
  excluded: readonly T[],
): { possible: T[]; excluded: T[] } {
  const next = nextMarkerState(current)
  return {
    possible: next === 'possible'
      ? [...possible.filter((candidate) => candidate !== value), value]
      : possible.filter((candidate) => candidate !== value),
    excluded: next === 'excluded'
      ? [...excluded.filter((candidate) => candidate !== value), value]
      : excluded.filter((candidate) => candidate !== value),
  }
}
