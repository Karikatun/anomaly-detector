import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

const accessSlots = [
  { slot: 1, labelKey: 'tender.access.slot.emergency', termsKey: 'tender.access.cost.emergency' },
  { slot: 2, labelKey: 'tender.access.slot.priority', termsKey: 'tender.access.cost.priority' },
  { slot: 3, labelKey: 'tender.access.slot.standard', termsKey: 'tender.access.neutral' },
  { slot: 4, labelKey: 'tender.access.slot.offPeak', termsKey: 'tender.access.compensation.sample' },
  { slot: 5, labelKey: 'tender.access.slot.night', termsKey: 'tender.access.compensation.report' },
  { slot: 6, labelKey: 'tender.access.slot.remote', termsKey: 'tender.access.compensation.remote' },
] as const

type AccessSlotPanelProps = {
  disabled?: boolean
  error?: string | null
  onConfirm: (slot: number) => void
}

export function AccessSlotPanel({ disabled, error, onConfirm }: AccessSlotPanelProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const { t } = useI18n()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.access.title')}</CardTitle>
        <CardDescription>
          {t('tender.access.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {accessSlots.map(({ slot, labelKey, termsKey }) => {
            const isSelected = selected === slot
            const label = t(labelKey)
            const terms = t(termsKey)

            return (
              <Button
                key={slot}
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                size="lg"
                aria-label={t('tender.access.aria', { slot, name: label, order: slot, terms })}
                className="flex h-auto min-h-44 flex-col gap-2 py-4 text-left"
                disabled={disabled}
                onClick={() => setSelected(slot)}
              >
                <Typography variant="h6">{String(slot).padStart(2, '0')}</Typography>
                <Typography variant="control" tone="muted">
                  {label}
                </Typography>
                <Typography variant="control" tone="muted">
                  {t('tender.access.order', { order: slot })}
                </Typography>
                <Typography variant="control" className="text-center">
                  {terms}
                </Typography>
              </Button>
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
          disabled={disabled || selected === null}
          onClick={() => {
            if (selected !== null) {
              onConfirm(selected)
              setSelected(null)
            }
          }}
        >
          {t('tender.access.confirm')}
        </Button>
      </CardContent>
    </Card>
  )
}
