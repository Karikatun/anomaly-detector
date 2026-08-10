import type { TenderPhase } from '@anomaly-detector/contracts'

const phaseDurationMs = 90_000
const finalScientificModelDurationMs = 180_000

export const deadlineForPhase = (phase: TenderPhase, at: Date) => {
  if (phase === 'complete') return null
  const durationMs = phase === 'final-scientific-model'
    ? finalScientificModelDurationMs
    : phaseDurationMs
  return new Date(at.getTime() + durationMs)
}
