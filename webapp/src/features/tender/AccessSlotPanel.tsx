import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { TenderActionPanel } from './components/TenderActionPanel'
import { runTenderAction } from './run-tender-action'

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
    <TenderActionPanel
      title={t('tender.access.title')}
      description={t('tender.access.description')}
      error={error}
      footer={(
        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || isConfirmed || selected === null}
          onClick={() => void (async () => {
            if (selected === null) return
            const succeeded = await runTenderAction(() => onConfirm(selected))
            if (succeeded) setSelected(null)
          })()}
        >
          {isConfirmed ? t('tender.access.confirmed.button') : t('tender.access.confirm')}
        </Button>
      )}
    >
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
                <Typography variant="controlWrap" tone="muted" className="w-full">
                  {label}
                </Typography>
                <Typography variant="controlWrap" tone="muted" className="w-full">
                  {t('tender.access.order', { order: slot })}
                </Typography>
                <Typography variant="controlWrap" align="center" className="w-full">
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
    </TenderActionPanel>
  )
}
