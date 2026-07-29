const signalCount = 6

export type PowerAllocationDraft = {
  reconnaissance: number
  laboratory: number
  modelAnalysis: number
  contracts: number
}

export function powerAllocationLimits(sampleCount: number) {
  return {
    reconnaissance: Math.min(2, Math.max(0, signalCount - sampleCount)),
    laboratory: 2,
    modelAnalysis: 2,
    contracts: 1,
  } as const
}

export function powerAllocationProblem({
  allocation,
  sampleCount,
}: {
  allocation: PowerAllocationDraft
  sampleCount: number
}) {
  if (allocation.reconnaissance > powerAllocationLimits(sampleCount).reconnaissance) {
    return 'reconnaissance-exceeds-missing-samples' as const
  }
  if (allocation.laboratory > 0 && sampleCount + allocation.reconnaissance < 2) {
    return 'laboratory-needs-two-samples' as const
  }
  return null
}
