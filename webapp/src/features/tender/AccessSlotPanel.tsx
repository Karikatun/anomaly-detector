import {
  Alert01Icon,
  CheckmarkCircle02Icon,
  Coins01Icon,
  InformationCircleIcon,
  SignalFullIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import styles from './AccessSlotPanel.module.css'
import { runTenderAction } from './run-tender-action'

const accessSlots = [
  {
    accent: '#ff554f',
    effects: [
      { icon: Coins01Icon, valueKey: 'tender.access.effect.emergency' },
    ],
    labelKey: 'tender.access.slot.emergency',
    slot: 1,
    termsKey: 'tender.access.cost.emergency',
  },
  {
    accent: '#f7a928',
    effects: [
      { icon: Coins01Icon, valueKey: 'tender.access.effect.priority' },
    ],
    labelKey: 'tender.access.slot.priority',
    slot: 2,
    termsKey: 'tender.access.cost.priority',
  },
  {
    accent: '#38bdf8',
    effects: [],
    labelKey: 'tender.access.slot.standard',
    slot: 3,
    termsKey: 'tender.access.neutral',
  },
  {
    accent: '#62d77d',
    effects: [
      { icon: Coins01Icon, valueKey: 'tender.access.effect.budget' },
    ],
    labelKey: 'tender.access.slot.offPeak',
    slot: 4,
    termsKey: 'tender.access.compensation.budget',
  },
  {
    accent: '#bd72f4',
    effects: [
      { icon: SignalFullIcon, valueKey: 'tender.access.effect.sampleValue' },
    ],
    labelKey: 'tender.access.slot.night',
    slot: 5,
    termsKey: 'tender.access.compensation.sample',
  },
  {
    accent: '#39d5df',
    effects: [
      { icon: Coins01Icon, valueKey: 'tender.access.effect.budget' },
      { icon: SignalFullIcon, valueKey: 'tender.access.effect.sampleValue' },
    ],
    labelKey: 'tender.access.slot.remote',
    slot: 6,
    termsKey: 'tender.access.compensation.remote',
  },
] as const

type AccessSlotPanelProps = {
  children?: ReactNode
  confirmedSlot?: number
  currentUserId?: string
  disabled?: boolean
  error?: string | null
  onConfirm: (slot: number) => Promise<void>
  tiePriorityOrder: Array<{ displayName?: string; playerId: string; tiePriority?: number }>
}

const slotStyle = (accent: string) => ({
  '--slot-accent': accent,
} as CSSProperties)

export function AccessSlotPanel({
  children,
  confirmedSlot,
  currentUserId,
  disabled,
  error,
  onConfirm,
  tiePriorityOrder,
}: AccessSlotPanelProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const { t } = useI18n()
  const confirmedSlotInfo = accessSlots.find(({ slot }) => slot === confirmedSlot)
  const selectedSlot = confirmedSlot ?? selected
  const selectedSlotInfo = accessSlots.find(({ slot }) => slot === selectedSlot)
  const isConfirmed = confirmedSlotInfo !== undefined
  const tiePriorityPlayers = tiePriorityOrder
    .filter((player) => player.tiePriority !== undefined)
    .sort((left, right) => (left.tiePriority ?? Number.MAX_SAFE_INTEGER) - (right.tiePriority ?? Number.MAX_SAFE_INTEGER))
  const currentPlayer = tiePriorityPlayers.find((player) => player.playerId === currentUserId)
  const currentPlayerName = currentPlayer?.displayName ?? currentPlayer?.playerId ?? t('tender.access.youShort')
  const currentPlayerNameParts = currentPlayerName.split(/\s+/)
  const currentPlayerInitials = (
    currentPlayerNameParts.length > 1
      ? currentPlayerNameParts.map((part) => part[0]).join('')
      : currentPlayerName.slice(0, 2)
  ).slice(0, 2).toUpperCase()

  return (
    <section
      className={styles.panel}
      data-with-context={children ? true : undefined}
      aria-labelledby="access-slot-heading"
    >
      <Typography id="access-slot-heading" variant="h3" className="sr-only">
        {t('tender.access.title')}
      </Typography>

      <div className={styles.playerBar}>
        <div className={styles.currentPlayer}>
          <Typography as="span" variant="bodySmMedium" className={styles.playerAvatar}>
            {currentPlayerInitials}
          </Typography>
          <Typography as="span" variant="bodySm">
            {t('tender.access.you', { name: currentPlayerName })}
          </Typography>
        </div>

        <ol className={styles.playerStrip} aria-label={t('tender.access.tiePriorityLabel')}>
          {tiePriorityPlayers.filter((player) => player.playerId !== currentUserId).map((player) => (
            <li key={player.playerId} className={styles.playerChip}>
              <Typography as="span" variant="caption" className={styles.priorityIndex}>
                {player.tiePriority}
              </Typography>
              <Typography as="span" variant="bodySm" className="min-w-0 truncate">
                {player.displayName ?? player.playerId}
              </Typography>
            </li>
          ))}
        </ol>

        <div className={styles.playerCount}>
          <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography as="span" variant="bodySm" tone="muted">
            {t('tender.access.onlineCount', { count: tiePriorityOrder.length })}
          </Typography>
        </div>
      </div>

      <div className={styles.stationBackdrop} aria-hidden="true" />

      {children && (
        <div className={styles.researchContext}>
          {children}
        </div>
      )}

      <div className={styles.slotGrid} role="group" aria-label={t('tender.access.gridLabel')}>
        {accessSlots.map(({ accent, effects, labelKey, slot, termsKey }) => {
          const isSelected = selectedSlot === slot
          const label = t(labelKey)
          const terms = t(termsKey)

          return (
            <button
              key={slot}
              type="button"
              aria-label={t('tender.access.aria', { slot, name: label, order: slot, terms })}
              aria-pressed={isSelected}
              className={styles.slotCard}
              data-selected={isSelected || undefined}
              disabled={disabled || isConfirmed}
              onClick={() => setSelected(slot)}
              style={slotStyle(accent)}
            >
              {isSelected && (
                <span className={styles.selectedBadge}>
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} aria-hidden="true" />
                  <Typography as="span" variant="caption">{t('tender.access.selected')}</Typography>
                </span>
              )}

              <Typography as="span" variant="h1" className={styles.slotNumber}>
                {String(slot).padStart(2, '0')}
              </Typography>
              <Typography as="span" variant="h5" className={styles.slotName}>
                {label}
              </Typography>

              <Typography as="span" variant="caption" className="sr-only">{terms}</Typography>
              {effects.length > 0 && (
                <span className={styles.effects} data-multiple={effects.length > 1 || undefined}>
                  {effects.map((effect) => (
                    <span key={effect.valueKey} className={styles.effect}>
                      <HugeiconsIcon icon={effect.icon} strokeWidth={1.7} aria-hidden="true" />
                      <Typography as="strong" variant="bodySmMedium">
                        {t(effect.valueKey)}
                      </Typography>
                    </span>
                  ))}
                </span>
              )}
              {effects.length === 0 && (
                <span className={styles.effects}>
                  <Typography as="span" variant="bodySmMedium" className={styles.neutralEffect}>
                    —
                  </Typography>
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className={styles.rule}>
        <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
        <div className="grid gap-0.5">
          <Typography variant="bodySmMedium">{t('tender.access.ruleTitle')}</Typography>
          <Typography variant="bodySm" tone="muted">{t('tender.access.ruleCompact')}</Typography>
          <Typography variant="bodySm" className={styles.priorityNames}>
            {tiePriorityPlayers.map((player) => player.displayName ?? player.playerId).join(' → ')}
          </Typography>
          <Typography as="span" variant="caption" className="sr-only">
            {t('tender.access.tiePriority', {
              players: tiePriorityPlayers.map((player) => player.displayName ?? player.playerId).join(' → '),
            })}
          </Typography>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.8} aria-hidden="true" />
          <Typography variant="bodySm" tone="destructive">{error}</Typography>
        </div>
      )}

      {isConfirmed ? (
        <div className={styles.confirmed} role="status">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.7} aria-hidden="true" />
          <span>
            <Typography as="strong" variant="bodySmMedium">{t('tender.access.confirmed.title')}</Typography>
            <Typography variant="bodySm" tone="muted">
              {t('tender.access.confirmed.description', {
                slot: confirmedSlotInfo.slot,
                name: t(confirmedSlotInfo.labelKey),
              })}
            </Typography>
          </span>
          <Button
            type="button"
            variant="outline"
            disabled
            aria-label="Выбор принят — ожидаем игроков"
            className={styles.confirmedButton}
          >
            {t('tender.access.confirmed.button')}
          </Button>
        </div>
      ) : (
        <div className={styles.footer}>
          <Button
            type="button"
            size="lg"
            aria-label={t('tender.access.confirm')}
            className={styles.confirmButton}
            disabled={disabled || selected === null}
            onClick={() => void (async () => {
              if (selected === null) return
              const succeeded = await runTenderAction(() => onConfirm(selected))
              if (succeeded) setSelected(null)
            })()}
          >
            {selectedSlotInfo
              ? t('tender.access.confirmSlot', { slot: selectedSlotInfo.slot })
              : t('tender.access.confirm')}
          </Button>
          <div className={styles.lockWarning}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.8} aria-hidden="true" />
            <Typography variant="bodySm" tone="muted">{t('tender.access.lockWarning')}</Typography>
          </div>
        </div>
      )}
    </section>
  )
}
