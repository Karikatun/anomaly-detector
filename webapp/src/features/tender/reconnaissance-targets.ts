import type { SignalId } from '@anomaly-detector/contracts'

export function availableReconnaissanceTargets({
  knownSignals,
  mySamples,
}: {
  knownSignals: SignalId[]
  mySamples: SignalId[]
}) {
  return [
    'unknown-sector-1',
    'unknown-sector-2',
    ...knownSignals.filter((signal) => !mySamples.includes(signal)),
  ]
}
