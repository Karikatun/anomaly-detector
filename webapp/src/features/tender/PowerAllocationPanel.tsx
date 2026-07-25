import {
  Alert01Icon,
  Atom01Icon,
  CheckmarkCircle02Icon,
  ContractsIcon,
  FlaskConicalIcon,
  InformationCircleIcon,
  LockIcon,
  Radar02Icon,
  TestTube01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { PowerAllocation, TenderView } from '@anomaly-detector/contracts'
import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import styles from './PowerAllocationPanel.module.css'
import {
  powerAllocationLimits,
  powerAllocationProblem,
  type PowerAllocationDraft,
} from './power-allocation-constraints'
import { runTenderAction } from './run-tender-action'

const categories = [
  {
    accent: '#38bdf8',
    icon: Radar02Icon,
    key: 'reconnaissance',
    labelKey: 'tender.power.category.reconnaissance',
    oneEffectKey: 'tender.power.reconnaissance.one',
    twoEffectKey: 'tender.power.reconnaissance.two',
  },
  {
    accent: '#70c8ff',
    icon: FlaskConicalIcon,
    key: 'laboratory',
    labelKey: 'tender.power.category.laboratory',
    oneEffectKey: 'tender.power.laboratory.one',
    twoEffectKey: 'tender.power.laboratory.two',
  },
  {
    accent: '#62d5f4',
    icon: Atom01Icon,
    key: 'modelAnalysis',
    labelKey: 'tender.power.category.modelAnalysis',
    oneEffectKey: 'tender.power.modelAnalysis.one',
    twoEffectKey: null,
  },
  {
    accent: '#52c9f8',
    icon: ContractsIcon,
    key: 'contracts',
    labelKey: 'tender.power.category.contracts',
    oneEffectKey: 'tender.power.contracts.one',
    twoEffectKey: null,
  },
] as const

type PowerAllocationPanelProps = {
  confirmedAllocation?: PowerAllocation
  currentUserId?: string
  disabled?: boolean
  error?: string | null
  players: TenderView['players']
  sampleCount: number
  onConfirm: (allocation: PowerAllocation) => Promise<void>
}

const categoryStyle = (accent: string) => ({
  '--power-accent': accent,
} as CSSProperties)

const actionPower = (allocation: PowerAllocation | PowerAllocationDraft) =>
  allocation.reconnaissance
  + allocation.laboratory
  + allocation.modelAnalysis
  + allocation.contracts

export function PowerAllocationPanel({
  confirmedAllocation,
  currentUserId,
  disabled,
  error,
  players,
  sampleCount,
  onConfirm,
}: PowerAllocationPanelProps) {
  const [allocation, setAllocation] = useState<PowerAllocationDraft>(() => ({
    reconnaissance: confirmedAllocation?.reconnaissance ?? 0,
    laboratory: confirmedAllocation?.laboratory ?? 0,
    modelAnalysis: confirmedAllocation?.modelAnalysis ?? 0,
    contracts: confirmedAllocation?.contracts ?? 0,
  }))
  const { t } = useI18n()
  const total = useMemo(() => actionPower(allocation), [allocation])
  const reserve = 4 - total
  const limits = powerAllocationLimits(sampleCount)
  const problem = powerAllocationProblem({ allocation, sampleCount })
  const validationError = error ?? (problem ? t(`tender.power.problem.${problem}`) : null)
  const isConfirmed = confirmedAllocation !== undefined
  const confirmedPlayers = players.filter((player) => player.powerAllocationConfirmed).length
  const waitingPlayers = Math.max(0, players.length - confirmedPlayers)
  const currentPlayer = players.find((player) => player.playerId === currentUserId)
  const currentPlayerName = currentPlayer?.displayName ?? currentPlayer?.playerId ?? t('tender.access.youShort')
  const currentPlayerInitials = currentPlayerName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const increment = (key: keyof PowerAllocationDraft, limit: number) => {
    setAllocation((current) => {
      if (current[key] >= limit || actionPower(current) >= 4) return current
      return { ...current, [key]: current[key] + 1 }
    })
  }

  const decrement = (key: keyof PowerAllocationDraft) => {
    setAllocation((current) => {
      if (current[key] <= 0) return current
      return { ...current, [key]: current[key] - 1 }
    })
  }

  return (
    <section className={styles.panel} aria-labelledby="power-allocation-heading">
      <Typography id="power-allocation-heading" variant="h3" className="sr-only">
        {t('tender.power.title')}
      </Typography>

      <div className={styles.playerBar}>
        <div className={styles.playerStatusLabel}>
          <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography as="span" variant="bodySmMedium">
            {t('tender.power.playerStatusTitle')}
          </Typography>
        </div>
        <div className={styles.currentPlayer}>
          <Typography as="span" variant="bodySmMedium" className={styles.playerAvatar}>
            {currentPlayerInitials}
          </Typography>
          <span className={styles.playerNameLine}>
            <Typography as="strong" variant="bodySmMedium">{t('tender.access.youShort')}</Typography>
            <Typography as="span" variant="bodySm"> · {currentPlayerName}</Typography>
          </span>
        </div>
        <div className={styles.playerStatuses}>
          {players.map((player) => (
            <span key={player.playerId} className={styles.playerStatus}>
              <Typography as="span" variant="bodySmMedium" className="truncate">
                {player.playerId === currentUserId ? t('tender.access.youShort') : player.displayName ?? player.playerId}
              </Typography>
              <span
                className={styles.playerState}
                data-confirmed={player.powerAllocationConfirmed || undefined}
              >
                <span className={styles.playerStateDot} aria-hidden="true" />
                <Typography as="span" variant="caption">
                  {player.powerAllocationConfirmed
                    ? t('tender.power.playerConfirmed')
                    : t('tender.power.playerChoosing')}
                </Typography>
              </span>
            </span>
          ))}
        </div>
        <div className={styles.playerCount}>
          <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography as="span" variant="bodySm" tone="muted">
            {t('tender.access.onlineCount', { count: players.length })}
          </Typography>
        </div>
      </div>

      <div className={styles.sampleBar}>
        <span className={styles.sampleIcon} aria-hidden="true">
          <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} />
        </span>
        <Typography variant="bodySm" className={styles.sampleCount}>
          {t('tender.power.samples', { count: sampleCount })}
        </Typography>
        <span className={styles.sampleRule}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm" tone="muted">
            {t('tender.power.laboratoryRequirement')}
          </Typography>
        </span>
      </div>

      {validationError && (
        <div className={styles.error} role="alert">
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <Typography as="strong" variant="bodySmMedium">{t('tender.power.fixAllocation')}</Typography>
            <Typography variant="bodySm">{validationError}</Typography>
          </span>
        </div>
      )}

      <div className={styles.categoryGrid} data-locked={isConfirmed || undefined}>
        {categories.map(({ accent, icon, key, labelKey, oneEffectKey, twoEffectKey }) => {
          const label = t(labelKey)
          const limit = limits[key]
          const value = isConfirmed ? confirmedAllocation[key] : allocation[key]
          const isCategoryInvalid = key === 'reconnaissance'
            && value > limits.reconnaissance

          return (
            <article
              key={key}
              className={styles.categoryCard}
              data-invalid={isCategoryInvalid || undefined}
              style={categoryStyle(accent)}
            >
              <div className={styles.categoryIntro}>
                <span className={styles.categoryIcon} aria-hidden="true">
                  <HugeiconsIcon icon={icon} strokeWidth={1.55} />
                </span>
                <span className={styles.categoryTitle}>
                  <Typography as="h3" variant="h5">{label}</Typography>
                  <span>
                    <Typography as="strong" variant="bodySmMedium">0–{limit}</Typography>
                    <Typography as="span" variant="bodySm">
                      {' '}{limit === 1 ? t('tender.power.unit.one') : t('tender.power.unit.many')}
                    </Typography>
                  </span>
                </span>
              </div>

              <ul className={styles.effects}>
                <li>
                  <Typography as="span" variant="bodySm">
                    {t(oneEffectKey).replace(/^1 мощность:\s*/u, '1: ')}
                  </Typography>
                </li>
                {twoEffectKey && (
                  <li>
                    <Typography as="span" variant="bodySm">
                      {t(twoEffectKey).replace(/^2 мощности:\s*/u, '2: ')}
                    </Typography>
                  </li>
                )}
              </ul>

              {isConfirmed ? (
                <div className={styles.lockedValue}>
                  <Typography as="strong" variant="h3">{value}</Typography>
                  <HugeiconsIcon icon={LockIcon} strokeWidth={1.7} aria-hidden="true" />
                </div>
              ) : (
                <div className={styles.stepper}>
                  <button
                    type="button"
                    aria-label={t('tender.power.decrease', { category: label })}
                    disabled={disabled || value <= 0}
                    onClick={() => decrement(key)}
                  >
                    <Typography as="span" variant="h5">−</Typography>
                  </button>
                  <Typography as="strong" variant="h3">{value}</Typography>
                  <button
                    type="button"
                    aria-label={t('tender.power.increase', { category: label })}
                    disabled={disabled || value >= limit || total >= 4}
                    onClick={() => increment(key, limit)}
                  >
                    <Typography as="span" variant="h5">+</Typography>
                  </button>
                </div>
              )}

              <Typography variant="caption" className={styles.limitNote}>
                {key === 'reconnaissance'
                  ? t('tender.power.availableTargets', {
                      count: 6 - sampleCount,
                      max: limit,
                    })
                  : t('tender.power.maximum', { count: limit })}
              </Typography>
            </article>
          )
        })}
      </div>

      <div className={styles.allocationSummary}>
        <span>
          <Typography as="span" variant="bodySm">{t('tender.power.allocated')}</Typography>
          <Typography as="strong" variant="bodySmMedium">{total} / 4</Typography>
        </span>
        <span>
          <Typography as="span" variant="bodySm">{t('tender.power.reserve')}</Typography>
          <Typography as="strong" variant="bodySmMedium">{reserve}</Typography>
        </span>
      </div>

      {isConfirmed && (
        <div className={styles.confirmedState}>
          <div className={styles.confirmedBanner} role="status">
            <span className={styles.confirmedIcon}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span>
              <Typography as="strong" variant="h5">{t('tender.power.confirmedTitle')}</Typography>
              <Typography variant="bodySm" tone="muted">{t('tender.power.confirmedDescription')}</Typography>
            </span>
          </div>

          <div className={styles.waiting}>
            <span className={styles.waitingProgress} aria-label={t('tender.power.confirmedCount', {
              confirmed: confirmedPlayers,
              total: players.length,
            })}>
              <Typography as="strong" variant="bodySmMedium">{confirmedPlayers}</Typography>
              <Typography as="span" variant="caption"> / {players.length}</Typography>
            </span>
            <span className={styles.waitingCopy}>
              <Typography as="strong" variant="bodySmMedium">
                {waitingPlayers > 0
                  ? t('tender.power.waitingForPlayers', { count: waitingPlayers })
                  : t('tender.power.everyoneConfirmed')}
              </Typography>
              <Typography variant="bodySm" tone="muted">
                {t('tender.power.waitingDescription')}
              </Typography>
            </span>
          </div>
        </div>
      )}

      {!isConfirmed && (
        <footer className={styles.footer}>
          <Button
            type="button"
            size="lg"
            className={styles.confirmButton}
            disabled={disabled || problem !== null}
            onClick={() => void runTenderAction(() => onConfirm({
              ...allocation,
              ...(reserve > 0 ? { reserve } : {}),
            }))}
          >
            {t('tender.power.confirm')}
          </Button>
          <div className={styles.lockWarning}>
            <HugeiconsIcon icon={LockIcon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm" tone="muted">{t('tender.power.secretWarning')}</Typography>
          </div>
        </footer>
      )}
    </section>
  )
}
