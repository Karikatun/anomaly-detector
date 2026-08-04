import { translate } from '../../platform/i18n'
import { InformationCircleIcon, SignalFullIcon } from '@hugeicons/core-free-icons'
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
import { PhaseNotice } from './components/TenderActionPanel'

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

function SampleInventory({ mySamples }: { mySamples: SignalId[] }) {
  const { t } = useI18n()

  return (
    <aside className={styles.surface}>
      <div className={styles.sectionHeader}>
        <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.reconnaissancePanel.copy.001')}</Typography>
        <Typography as="span" variant="caption" className={styles.sectionMeta}>{mySamples.length} / 6</Typography>
      </div>
      {mySamples.length === 0 ? (
        <Typography variant="bodySm" tone="muted">{translate('tender.reconnaissancePanel.copy.002')}</Typography>
      ) : (
        <div className={styles.compactList}>
          {mySamples.map((signal) => (
            <div key={signal} className={styles.compactSignal} style={targetStyle(signal)}>
              <SignalGlyph signal={signal} className={styles.signalGlyph} />
              <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[signal])}</Typography>
              <HugeiconsIcon icon={SignalFullIcon} strokeWidth={1.7} aria-label={translate('tender.reconnaissancePanel.copy.003')} />
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

export function ReconnaissanceUnavailable({ mySamples }: { mySamples: SignalId[] }) {
  return (
    <section className={styles.panel} aria-label={translate('tender.reconnaissancePanel.copy.004')}>
      <PhaseNotice description={translate('tender.reconnaissancePanel.copy.005')}>
        
        {translate('tender.reconnaissancePanel.copy.006')}
      </PhaseNotice>
      <SampleInventory mySamples={mySamples} />
    </section>
  )
}

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
    await runTenderAction(() => onConfirm(targets))
  }

  const renderTarget = (target: string, index: number) => {
    const signal = isSignalId(target) ? target : undefined
    const isSelected = selected.has(target)
    const selectionIndex = isSelected ? [...selected].indexOf(target) + 1 : null
    const label = signal
      ? signalName(signal)
      : translate('tender.reconnaissancePanel.copy.007', { value1: String.fromCharCode(65 + index) })

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
            {signal ? translate('tender.reconnaissancePanel.copy.008') : translate('tender.reconnaissancePanel.copy.009')}
          </Typography>
        </span>
        {isSelected && <Typography as="span" variant="caption" className={styles.selectedTag}>{translate('tender.reconnaissancePanel.copy.010')}</Typography>}
      </button>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="recon-heading">
      <Typography id="recon-heading" as="h2" variant="srOnly">{translate('tender.reconnaissancePanel.copy.011')}</Typography>

      <div className={styles.split}>
        <div className={styles.surface}>
          {available.length === 0 && <Typography tone="muted">{t('tender.recon.empty')}</Typography>}

          {unknownTargets.length > 0 && (
            <section>
              <div className={styles.sectionHeader}>
                <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.reconnaissancePanel.copy.012')}</Typography>
                <Typography as="span" variant="caption" className={styles.sectionMeta}>{translate('tender.reconnaissancePanel.copy.013')}</Typography>
              </div>
              <div className={styles.signalGrid}>
                {unknownTargets.map(renderTarget)}
              </div>
            </section>
          )}

          {revealedTargets.length > 0 && (
            <section className={unknownTargets.length > 0 ? 'mt-4' : undefined}>
              <div className={styles.sectionHeader}>
                <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.reconnaissancePanel.copy.014')}</Typography>
                <Typography as="span" variant="caption" className={styles.sectionMeta}>{translate('tender.reconnaissancePanel.copy.015')}</Typography>
              </div>
              <div className={styles.signalGrid}>
                {revealedTargets.map((target, index) => renderTarget(target, index))}
              </div>
            </section>
          )}
        </div>

        <SampleInventory mySamples={mySamples} />
      </div>

      {error && (
        <div className={styles.error} role="alert">
          <Typography variant="bodySm">{error}</Typography>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography as="span" variant="bodySm">{translate('tender.reconnaissancePanel.copy.016')}</Typography>
          <Typography as="strong" variant="bodySmMedium">{selected.size}</Typography>
          <Typography as="span" variant="bodySm">{translate('tender.recon.selectionLimit', { total: maxSignals })}</Typography>
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
