import { translate } from '../../platform/i18n'
import type { TenderView } from '@anomaly-detector/contracts'

type TenderPhase = TenderView['phase']

const roundStages = [
  { phase: 'access-slot-selection', shortLabel: translate('tender.phase-ui.copy.001'), label: translate('tender.phase-ui.copy.002') },
  { phase: 'power-allocation', shortLabel: translate('tender.phase-ui.copy.003'), label: translate('tender.phase-ui.copy.004') },
  { phase: 'reconnaissance', shortLabel: translate('tender.phase-ui.copy.005'), label: translate('tender.phase-ui.copy.006') },
  { phase: 'laboratory', shortLabel: translate('tender.phase-ui.copy.007'), label: translate('tender.phase-ui.copy.008') },
  { phase: 'model-analysis', shortLabel: translate('tender.phase-ui.copy.009'), label: translate('tender.phase-ui.copy.010') },
  { phase: 'contracts', shortLabel: translate('tender.phase-ui.copy.011'), label: translate('tender.phase-ui.copy.012') },
] as const

export function getTenderPhaseProgressStages(phase: TenderPhase) {
  if (phase === 'complete') return []
  if (phase === 'final-scientific-model') {
    return [
      ...roundStages,
      { phase: 'final-scientific-model' as const, shortLabel: translate('tender.phase-ui.copy.013'), label: translate('tender.phase-ui.copy.014') },
    ]
  }
  return roundStages
}

export function getPhaseContextMenuVisibility(phase: TenderPhase) {
  return {
    contracts: phase !== 'contracts' && phase !== 'final-scientific-model' && phase !== 'complete',
    workingModel: phase !== 'model-analysis' && phase !== 'final-scientific-model' && phase !== 'complete',
  }
}

export function shouldLockPhaseOverlays({
  phase,
  remainingSeconds,
}: {
  phase: TenderPhase
  remainingSeconds: number
}) {
  return phase !== 'complete' && remainingSeconds <= 10
}
