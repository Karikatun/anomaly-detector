import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { TenderActionPanel } from './components/TenderActionPanel'
import {
  powerAllocationLimits,
  powerAllocationProblem,
  type PowerAllocationDraft,
} from './power-allocation-constraints'
import { runTenderAction } from './run-tender-action'

const categories = [
  { key: 'reconnaissance' as const, labelKey: 'tender.power.category.reconnaissance', oneEffectKey: 'tender.power.reconnaissance.one', twoEffectKey: 'tender.power.reconnaissance.two' },
  { key: 'laboratory' as const, labelKey: 'tender.power.category.laboratory', oneEffectKey: 'tender.power.laboratory.one', twoEffectKey: 'tender.power.laboratory.two' },
  { key: 'modelAnalysis' as const, labelKey: 'tender.power.category.modelAnalysis', oneEffectKey: 'tender.power.modelAnalysis.one', twoEffectKey: 'tender.power.modelAnalysis.two' },
  { key: 'contracts' as const, labelKey: 'tender.power.category.contracts', oneEffectKey: 'tender.power.contracts.one', twoEffectKey: 'tender.power.contracts.two' },
] as const

type PowerAllocationPanelProps = {
  sampleCount: number
  disabled?: boolean
  error?: string | null
  onConfirm: (allocation: PowerAllocationDraft) => Promise<void>
}

export function PowerAllocationPanel({ sampleCount, disabled, error, onConfirm }: PowerAllocationPanelProps) {
  const [allocation, setAllocation] = useState<PowerAllocationDraft>({
    reconnaissance: 0,
    laboratory: 0,
    modelAnalysis: 0,
    contracts: 0,
  })

  const total = useMemo(
    () => Object.values(allocation).reduce((sum, v) => sum + v, 0),
    [allocation],
  )
  const { t } = useI18n()
  const limits = powerAllocationLimits(sampleCount)
  const problem = powerAllocationProblem({ allocation, sampleCount })
  const isValid = total === 4 && problem === null

  const increment = (key: keyof PowerAllocationDraft, limit: number) => {
    setAllocation((prev) => {
      if (prev[key] >= limit || total >= 4) return prev
      return { ...prev, [key]: prev[key] + 1 }
    })
  }

  const decrement = (key: keyof PowerAllocationDraft) => {
    setAllocation((prev) => {
      if (prev[key] <= 0) return prev
      return { ...prev, [key]: prev[key] - 1 }
    })
  }

  return (
    <TenderActionPanel
      title={t('tender.power.title')}
      description={t('tender.power.description', { total })}
      error={error ?? (problem ? t(`tender.power.problem.${problem}`) : null)}
      footer={(
        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || !isValid}
          onClick={() => void runTenderAction(() => onConfirm(allocation))}
        >
          {isValid ? t('tender.power.confirm') : t('tender.power.remaining', { count: 4 - total })}
        </Button>
      )}
    >
        <div className="grid gap-4">
          {categories.map(({ key, labelKey, oneEffectKey, twoEffectKey }) => {
            const label = t(labelKey)
            const limit = limits[key]
            return (
            <div
              key={key}
              className="flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center"
            >
              <div className="grid min-w-0 flex-1 gap-1">
                <Typography variant="bodySmMedium">
                  {label}
                </Typography>
                <Typography variant="bodySmSnug" tone="muted">
                  {t(oneEffectKey)}
                </Typography>
                {limit > 1 && (
                  <Typography variant="bodySmSnug" tone="muted">
                    {t(twoEffectKey)}
                  </Typography>
                )}
                <Typography variant="bodySmSnug" tone="muted">
                  {t('tender.power.selected', { count: allocation[key] })}
                </Typography>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-end lg:self-center">
                <Button
                  aria-label={t('tender.power.decrease', { category: label })}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={disabled || allocation[key] <= 0}
                  onClick={() => decrement(key)}
                >
                  −
                </Button>
                <Typography variant="h6" className="w-6 text-center">
                  {allocation[key]}
                </Typography>
                <Button
                  aria-label={t('tender.power.increase', { category: label })}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={disabled || allocation[key] >= limit || total >= 4}
                  onClick={() => increment(key, limit)}
                >
                  +
                </Button>
              </div>
            </div>
            )
          })}
        </div>
    </TenderActionPanel>
  )
}
