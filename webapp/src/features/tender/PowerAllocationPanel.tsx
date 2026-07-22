import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

const categories = [
  { key: 'reconnaissance' as const, limit: 2, labelKey: 'tender.power.category.reconnaissance', oneEffectKey: 'tender.power.reconnaissance.one', twoEffectKey: 'tender.power.reconnaissance.two' },
  { key: 'laboratory' as const, limit: 2, labelKey: 'tender.power.category.laboratory', oneEffectKey: 'tender.power.laboratory.one', twoEffectKey: 'tender.power.laboratory.two' },
  { key: 'modelAnalysis' as const, limit: 1, labelKey: 'tender.power.category.modelAnalysis', oneEffectKey: 'tender.power.modelAnalysis.one', twoEffectKey: 'tender.power.modelAnalysis.two' },
  { key: 'contracts' as const, limit: 1, labelKey: 'tender.power.category.contracts', oneEffectKey: 'tender.power.contracts.one', twoEffectKey: 'tender.power.contracts.two' },
] as const

type Allocation = {
  reconnaissance: number
  laboratory: number
  modelAnalysis: number
  contracts: number
}

type PowerAllocationPanelProps = {
  disabled?: boolean
  error?: string | null
  onConfirm: (allocation: Allocation) => void
}

export function PowerAllocationPanel({ disabled, error, onConfirm }: PowerAllocationPanelProps) {
  const [allocation, setAllocation] = useState<Allocation>({
    reconnaissance: 0,
    laboratory: 0,
    modelAnalysis: 0,
    contracts: 0,
  })

  const total = useMemo(
    () => Object.values(allocation).reduce((sum, v) => sum + v, 0),
    [allocation],
  )
  const isValid = total === 4
  const { t } = useI18n()

  const increment = (key: keyof Allocation, limit: number) => {
    setAllocation((prev) => {
      if (prev[key] >= limit || total >= 4) return prev
      return { ...prev, [key]: prev[key] + 1 }
    })
  }

  const decrement = (key: keyof Allocation) => {
    setAllocation((prev) => {
      if (prev[key] <= 0) return prev
      return { ...prev, [key]: prev[key] - 1 }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.power.title')}</CardTitle>
        <CardDescription>
          {t('tender.power.description', { total })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {categories.map(({ key, limit, labelKey, oneEffectKey, twoEffectKey }) => {
            const label = t(labelKey)
            return (
            <div
              key={key}
              className="flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center"
            >
              <div className="grid min-w-0 flex-1 gap-1">
                <Typography variant="bodySm" className="font-medium">
                  {label}
                </Typography>
                <Typography variant="bodySm" tone="muted" className="leading-snug">
                  {t(oneEffectKey)}
                </Typography>
                <Typography variant="bodySm" tone="muted" className="leading-snug">
                  {t(twoEffectKey)}
                </Typography>
                <Typography variant="bodySm" tone="muted" className="leading-snug">
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

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}

        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || !isValid}
          onClick={() => {
            if (isValid) {
              onConfirm(allocation)
            }
          }}
        >
          {isValid ? t('tender.power.confirm') : t('tender.power.remaining', { count: 4 - total })}
        </Button>
      </CardContent>
    </Card>
  )
}
