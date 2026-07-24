import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

const accessSlots = [
  { slot: 1, labelKey: 'tender.access.slot.emergency', termsKey: 'tender.access.cost.emergency' },
  { slot: 2, labelKey: 'tender.access.slot.priority', termsKey: 'tender.access.cost.priority' },
  { slot: 3, labelKey: 'tender.access.slot.standard', termsKey: 'tender.access.neutral' },
  { slot: 4, labelKey: 'tender.access.slot.offPeak', termsKey: 'tender.access.compensation.budget' },
  { slot: 5, labelKey: 'tender.access.slot.night', termsKey: 'tender.access.compensation.sample' },
  { slot: 6, labelKey: 'tender.access.slot.remote', termsKey: 'tender.access.compensation.remote' },
] as const

type AccessSlotPanelProps = {
  confirmedSlot?: number
  disabled?: boolean
  error?: string | null
  onConfirm: (slot: number) => Promise<void>
  tiePriorityOrder: Array<{ displayName?: string; playerId: string; tiePriority?: number }>
}

export function AccessSlotPanel({ confirmedSlot, disabled, error, onConfirm, tiePriorityOrder }: AccessSlotPanelProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const { t } = useI18n()
  const confirmedSlotInfo = accessSlots.find(({ slot }) => slot === confirmedSlot)
  const selectedSlot = confirmedSlot ?? selected
  const isConfirmed = confirmedSlotInfo !== undefined
  const tiePriorityPlayers = tiePriorityOrder
    .filter((player) => player.tiePriority !== undefined)
    .sort((left, right) => (left.tiePriority ?? Number.MAX_SAFE_INTEGER) - (right.tiePriority ?? Number.MAX_SAFE_INTEGER))
    .map((player) => player.displayName ?? player.playerId)
    .join(' → ')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.access.title')}</CardTitle>
        <CardDescription>{t('tender.access.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {tiePriorityPlayers && (
          <Typography variant="bodySm" tone="muted" className="mb-4">
            {t('tender.access.tiePriority', { players: tiePriorityPlayers })}
          </Typography>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          {accessSlots.map(({ slot, labelKey, termsKey }) => {
            const isSelected = selectedSlot === slot
            const label = t(labelKey)
            const terms = t(termsKey)

            return (
              <Button
                key={slot}
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                size="lg"
                aria-label={t('tender.access.aria', { slot, name: label, order: slot, terms })}
                className="flex h-auto min-h-52 w-full min-w-0 flex-col gap-2 px-4 py-4 text-center"
                disabled={disabled || isConfirmed}
                onClick={() => setSelected(slot)}
              >
                <Typography variant="h6">{String(slot).padStart(2, '0')}</Typography>
                <Typography variant="control" tone="muted" className="w-full whitespace-normal leading-snug">
                  {label}
                </Typography>
                <Typography variant="control" tone="muted" className="w-full whitespace-normal leading-snug">
                  {t('tender.access.order', { order: slot })}
                </Typography>
                <Typography variant="control" className="w-full whitespace-normal text-center leading-snug">
                  {terms}
                </Typography>
              </Button>
            )
          })}
        </div>

        {confirmedSlotInfo && (
          <Typography role="status" variant="bodySm" className="mt-4">
            {t('tender.access.confirmed.title')}. {t('tender.access.confirmed.description', {
              slot: confirmedSlotInfo.slot,
              name: t(confirmedSlotInfo.labelKey),
            })}
          </Typography>
        )}

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}

        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || isConfirmed || selected === null}
          onClick={() => void (async () => {
            if (selected !== null) {
              try {
                await onConfirm(selected)
                setSelected(null)
              } catch {
                // The parent owns the visible command error; keep the choice for retry.
              }
            }
          })()}
        >
          {isConfirmed ? t('tender.access.confirmed.button') : t('tender.access.confirm')}
        </Button>
      </CardContent>
    </Card>
  )
}
