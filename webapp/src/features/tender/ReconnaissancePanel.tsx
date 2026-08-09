import { translate } from '../../platform/i18n'
import { CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { SignalId } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { isSignalId, signalLabelKeys } from './catalog'
import styles from './ReconnaissancePanel.module.css'
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'
import { availableReconnaissanceTargets, toggleReconnaissanceTarget } from './reconnaissance-targets'
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
    <aside className={styles.inventory} aria-labelledby="inspected-signals-heading">
      <div className={styles.sectionHeader}>
        <span className={styles.sectionHeadingCopy}>
          <Typography id="inspected-signals-heading" as="h3" variant="bodySmMedium" className={styles.sectionTitle}>
            {t('tender.recon.inspectedTitle')}
          </Typography>
          <Typography as="span" variant="caption" tone="muted">{t('tender.recon.inspectedDescription')}</Typography>
        </span>
        <Typography as="span" variant="caption" className={styles.sectionMeta}>
          {t('tender.recon.samplesCount', { count: mySamples.length })}
        </Typography>
      </div>
      {mySamples.length === 0 ? (
        <div className={styles.emptyInventory}>
          <Typography variant="bodySm" tone="muted">{translate('tender.reconnaissancePanel.copy.002')}</Typography>
        </div>
      ) : (
        <div className={styles.compactList}>
          {mySamples.map((signal) => (
            <article key={signal} className={styles.compactSignal} data-state="inspected" style={targetStyle(signal)}>
              <SignalGlyph signal={signal} className={styles.signalGlyph} />
              <span className={styles.inspectedCopy}>
                <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[signal])}</Typography>
                <Typography as="span" variant="caption" tone="muted">{t('tender.recon.inspectedDetail')}</Typography>
              </span>
              <span className={styles.stateBadge} data-state="inspected">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} aria-hidden="true" />
                <Typography as="span" variant="caption">{t('tender.recon.state.inspected')}</Typography>
              </span>
            </article>
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
  const selectedTargets = [...selected]

  const toggle = (signal: string) => {
    setSelected((previous) => toggleReconnaissanceTarget(previous, signal, maxSignals))
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
    const selectionIndex = isSelected ? selectedTargets.indexOf(target) + 1 : null
    const isAtLimit = !isSelected && selected.size >= maxSignals
    const label = signal
      ? signalName(signal)
      : translate('tender.reconnaissancePanel.copy.007', { value1: String.fromCharCode(65 + index) })

    return (
      <button
        aria-label={t('tender.recon.aria', { signal: label })}
        key={target}
        type="button"
        className={styles.signalCard}
        data-tutorial-recon-anchor={!signal && index === 0 ? '' : undefined}
        data-tutorial-recon-target={target}
        data-state={isSelected ? 'selected' : signal ? 'available' : 'unknown'}
        data-selected={isSelected || undefined}
        aria-pressed={isSelected}
        disabled={disabled || isAtLimit}
        onClick={() => toggle(target)}
        style={targetStyle(signal)}
      >
        <SignalGlyph signal={signal} className={styles.signalGlyph} />
        <span className={styles.signalCopy}>
          <span className={styles.targetStatusRow}>
            <Typography as="span" variant="caption" className={styles.targetType}>
              {signal ? t('tender.recon.state.available') : t('tender.recon.state.unknown')}
            </Typography>
            {selectionIndex && (
              <Typography as="span" variant="caption" className={styles.selectionIndex}>
                {t('tender.recon.state.selectedIndex', { index: selectionIndex })}
              </Typography>
            )}
            {isAtLimit && (
              <Typography as="span" variant="caption" className={styles.limitBadge}>
                {t('tender.recon.state.limitReached')}
              </Typography>
            )}
          </span>
          <Typography as="strong" variant="bodySmMedium" className={styles.signalName}>{label}</Typography>
          <Typography as="span" variant="caption" className={styles.signalDetail}>
            {signal ? translate('tender.reconnaissancePanel.copy.008') : translate('tender.reconnaissancePanel.copy.009')}
          </Typography>
        </span>
      </button>
    )
  }

  const selectionSlotIndexes = Array.from({ length: maxSignals }, (_, index) => index)
  const renderSelectionSlot = (index: number) => {
    const target = selectedTargets[index]
    const signal = target && isSignalId(target) ? target : undefined
    const label = target
      ? signal
        ? signalName(signal)
        : translate('tender.reconnaissancePanel.copy.007', { value1: String.fromCharCode(65 + unknownTargets.indexOf(target)) })
      : t('tender.recon.selectionEmpty')

    return (
      <span key={index} className={styles.selectionSlot} data-filled={target ? '' : undefined}>
        <Typography as="span" variant="caption">{t('tender.recon.selectionNumber', { index: index + 1 })}</Typography>
        <Typography as="strong" variant="bodySmMedium">{label}</Typography>
      </span>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="recon-heading">
      <Typography id="recon-heading" as="h2" variant="srOnly">{translate('tender.reconnaissancePanel.copy.011')}</Typography>

      <header className={styles.missionHeader}>
        <span className={styles.missionCopy}>
          <Typography as="h3" variant="h5">{t('tender.recon.missionTitle')}</Typography>
          <Typography variant="bodySm" tone="muted">
            {maxSignals === 1 ? t('tender.recon.description.one') : t('tender.recon.description.many')}
          </Typography>
        </span>
        <span className={styles.actionCapacity}>
          <Typography as="span" variant="caption">{t('tender.recon.availableActions')}</Typography>
          <Typography as="strong" variant="h4">{maxSignals}</Typography>
        </span>
      </header>

      <div className={styles.workspace}>
        <div className={styles.targetsSurface}>
          {available.length === 0 && <Typography tone="muted">{t('tender.recon.empty')}</Typography>}

          <div className={styles.targetGroups} data-tutorial-recon-options="">
            {unknownTargets.length > 0 && (
              <section className={styles.targetGroup}>
              <div className={styles.sectionHeader}>
                  <span className={styles.sectionHeadingCopy}>
                    <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.reconnaissancePanel.copy.012')}</Typography>
                    <Typography as="span" variant="caption" tone="muted">{translate('tender.reconnaissancePanel.copy.013')}</Typography>
                  </span>
              </div>
              <div className={styles.signalGrid}>
                {unknownTargets.map(renderTarget)}
              </div>
            </section>
            )}

            {revealedTargets.length > 0 && (
              <section className={styles.targetGroup}>
              <div className={styles.sectionHeader}>
                  <span className={styles.sectionHeadingCopy}>
                    <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.reconnaissancePanel.copy.014')}</Typography>
                    <Typography as="span" variant="caption" tone="muted">{translate('tender.reconnaissancePanel.copy.015')}</Typography>
                  </span>
              </div>
              <div className={styles.signalGrid}>
                {revealedTargets.map((target, index) => renderTarget(target, index))}
              </div>
            </section>
            )}
          </div>
        </div>

        <SampleInventory mySamples={mySamples} />
      </div>

      <footer className={styles.footer} data-tutorial-action-container="">
        <div className={styles.selectionPanel} aria-live="polite" aria-atomic="true">
          <span className={styles.selectionHeading}>
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="strong" variant="bodySmMedium">{t('tender.recon.selectionTitle')}</Typography>
            <Typography as="span" variant="caption" tone="muted">
              {t('tender.recon.selected', { selected: selected.size, total: maxSignals })}
            </Typography>
          </span>
          <div className={styles.selectionSlots}>
            {selectionSlotIndexes.map(renderSelectionSlot)}
          </div>
        </div>
        <div className={styles.confirmationArea}>
          {error && (
            <div className={styles.error} role="alert">
              <Typography variant="bodySm">{error}</Typography>
            </div>
          )}
          <Button
            type="button"
            size="lg"
            className={styles.actionButton}
            data-tutorial-confirm-ready={selected.size === maxSignals || undefined}
            disabled={disabled || selected.size !== maxSignals}
            onClick={() => void handleConfirm()}
          >
            {t('tender.recon.confirm')}
          </Button>
        </div>
      </footer>
    </section>
  )
}
