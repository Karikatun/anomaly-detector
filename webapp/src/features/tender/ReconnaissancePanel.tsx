import { InformationCircleIcon, TestTube01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { SignalId } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { isSignalId, signalLabelKeys } from './catalog'
import styles from './components/PhasePanel.module.css'
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'
import { availableReconnaissanceTargets } from './reconnaissance-targets'
import { runTenderAction } from './run-tender-action'

type ReconnaissancePanelProps = {
  mySamples: SignalId[]
  knownSignals: SignalId[]
  maxSignals: number
  disabled?: boolean
  error?: string | null
  onConfirm: (targets: Array<SignalId | 'unknown-sector'>) => Promise<void>
}

const targetStyle = (signal?: SignalId) => ({
  '--signal-accent': signal ? signalAccent(signal) : '#75879c',
} as CSSProperties)

export function ReconnaissancePanel({
  mySamples,
  knownSignals,
  maxSignals,
  disabled,
  error,
  onConfirm,
}: ReconnaissancePanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { t } = useI18n()
  const available = availableReconnaissanceTargets({ knownSignals, mySamples })
  const unknownTargets = available.filter((target) => target.startsWith('unknown-sector-'))
  const revealedTargets = available.filter(isSignalId)
  const signalName = (signal: SignalId) => t(signalLabelKeys[signal])

  const toggle = (signal: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(signal)) next.delete(signal)
      else if (next.size < maxSignals) next.add(signal)
      return next
    })
  }

  const handleConfirm = async () => {
    const targets = [...selected].map((target): SignalId | 'unknown-sector' => (
      target.startsWith('unknown-sector-') ? 'unknown-sector' : target as SignalId
    ))
    if (targets.length !== maxSignals) return
    const succeeded = await runTenderAction(() => onConfirm(targets))
    if (succeeded) setSelected(new Set())
  }

  const renderTarget = (target: string, index: number) => {
    const signal = isSignalId(target) ? target : undefined
    const isSelected = selected.has(target)
    const selectionIndex = isSelected ? [...selected].indexOf(target) + 1 : null
    const label = signal
      ? signalName(signal)
      : `Неизвестный сигнал ${String.fromCharCode(65 + index)}`

    return (
      <button
        aria-label={t('tender.recon.aria', { signal: label })}
        key={target}
        type="button"
        className={styles.signalCard}
        data-selected={isSelected || undefined}
        disabled={disabled || (!isSelected && selected.size >= maxSignals)}
        onClick={() => toggle(target)}
        style={targetStyle(signal)}
      >
        {selectionIndex && (
          <Typography as="span" variant="caption" className={styles.selectionIndex}>{selectionIndex}</Typography>
        )}
        <SignalGlyph signal={signal} className={styles.signalGlyph} />
        <span className={styles.signalCopy}>
          <Typography as="strong" variant="bodySmMedium" className={styles.signalName}>{label}</Typography>
          <Typography as="span" variant="caption" className={styles.signalDetail}>
            {signal ? 'Открытый сигнал · образца ещё нет' : 'Откроет новый сигнал'}
          </Typography>
        </span>
        {isSelected && <Typography as="span" variant="caption" className={styles.selectedTag}>Выбран</Typography>}
      </button>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="recon-heading">
      <div className={`${styles.surface} ${styles.intro}`}>
        <Typography id="recon-heading" as="h2" variant="h4" className={styles.title}>
          {maxSignals === 1 ? 'Выберите цель разведки' : `Выберите ${maxSignals} разные цели разведки`}
        </Typography>
        <Typography variant="bodySm" className={styles.description}>
          Выбор остаётся приватным до подтверждения. Новый сигнал станет публичным, образец получите только вы.
        </Typography>
      </div>

      <div className={styles.split}>
        <div className={styles.surface}>
          {available.length === 0 && <Typography tone="muted">{t('tender.recon.empty')}</Typography>}

          {unknownTargets.length > 0 && (
            <section>
              <div className={styles.sectionHeader}>
                <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Неизвестные сигналы</Typography>
                <Typography as="span" variant="caption" className={styles.sectionMeta}>Новый сигнал + образец</Typography>
              </div>
              <div className={styles.signalGrid}>
                {unknownTargets.map(renderTarget)}
              </div>
            </section>
          )}

          {revealedTargets.length > 0 && (
            <section className={unknownTargets.length > 0 ? 'mt-4' : undefined}>
              <div className={styles.sectionHeader}>
                <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Открытые сигналы</Typography>
                <Typography as="span" variant="caption" className={styles.sectionMeta}>Получить недостающий образец</Typography>
              </div>
              <div className={styles.signalGrid}>
                {revealedTargets.map((target, index) => renderTarget(target, index))}
              </div>
            </section>
          )}
        </div>

        <aside className={styles.surface}>
          <div className={styles.sectionHeader}>
            <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Ваши образцы</Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{mySamples.length} / 6</Typography>
          </div>
          {mySamples.length === 0 ? (
            <Typography variant="bodySm" tone="muted">Пока нет образцов.</Typography>
          ) : (
            <div className={styles.compactList}>
              {mySamples.map((signal) => (
                <div key={signal} className={styles.compactSignal} style={targetStyle(signal)}>
                  <SignalGlyph signal={signal} className={styles.signalGlyph} />
                  <Typography as="strong" variant="bodySmMedium">{signalName(signal)}</Typography>
                  <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-label="Образец получен" />
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          <Typography variant="bodySm">{error}</Typography>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography as="span" variant="bodySm">Выбрано</Typography>
          <Typography as="strong" variant="bodySmMedium">{selected.size}</Typography>
          <Typography as="span" variant="bodySm">из {maxSignals}</Typography>
        </div>
        <Button
          type="button"
          size="lg"
          className={styles.actionButton}
          disabled={disabled || selected.size !== maxSignals}
          onClick={() => void handleConfirm()}
        >
          {t('tender.recon.confirm')}
        </Button>
      </footer>
    </section>
  )
}
