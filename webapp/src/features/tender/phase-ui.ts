import type { TenderView } from '@anomaly-detector/contracts'

type TenderPhase = TenderView['phase']

const roundStages = [
  { phase: 'access-slot-selection', shortLabel: 'Доступ', label: 'Выбор слота доступа' },
  { phase: 'power-allocation', shortLabel: 'Мощность', label: 'Распределение мощности' },
  { phase: 'reconnaissance', shortLabel: 'Разведка', label: 'Разведка' },
  { phase: 'laboratory', shortLabel: 'Лаборатория', label: 'Лаборатория' },
  { phase: 'model-analysis', shortLabel: 'Модель', label: 'Анализ модели' },
  { phase: 'contracts', shortLabel: 'Контракты', label: 'Контракты' },
] as const

export function getTenderPhaseProgressStages(phase: TenderPhase) {
  if (phase === 'complete') return []
  if (phase === 'final-scientific-model') {
    return [
      ...roundStages,
      { phase: 'final-scientific-model' as const, shortLabel: 'Финал', label: 'Финальная модель' },
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
