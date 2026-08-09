import type { SignalId } from '@anomaly-detector/contracts'

export function availableReconnaissanceTargets({
  knownSignals,
  mySamples,
}: {
  knownSignals: SignalId[]
  mySamples: SignalId[]
}) {
  const unknownSectorCount = Math.min(2, 6 - new Set(knownSignals).size)
  return [
    ...Array.from({ length: unknownSectorCount }, (_, index) => `unknown-sector-${index + 1}`),
    ...knownSignals.filter((signal) => !mySamples.includes(signal)),
  ]
}

export function toggleReconnaissanceTarget(
  previous: ReadonlySet<string>,
  target: string,
  limit: number,
) {
  const next = new Set(previous)
  if (next.has(target)) next.delete(target)
  else if (next.size < limit) next.add(target)
  return next
}
