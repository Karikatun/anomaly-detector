import { LockIcon, TestTube01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { LaboratoryAction, SignalId, TenderView } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from './catalog'
import styles from './components/PhasePanel.module.css'
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'
import { areLaboratoryPairsEqual, isLaboratoryPairResearched } from './laboratory-pair'
import { runTenderAction } from './run-tender-action'
import { tenderRulesetPolicy } from './ruleset-policy'

type LaboratoryPanelProps = {
  journal: TenderView['publicScientificJournal']
  mySamples: SignalId[]
  playerId: string
  privateMeasurements: TenderView['privateMeasurements']
  powerAllocation: number
  ruleset?: TenderView['ruleset']
  disabled?: boolean
  error?: string | null
  onConfirm: (input: LaboratoryAction) => Promise<void>
}

const signalStyle = (signal?: SignalId) => ({
  '--signal-accent': signal ? signalAccent(signal) : '#64788c',
} as CSSProperties)

export function LaboratoryPanel({
  journal,
  mySamples,
  playerId,
  privateMeasurements,
  powerAllocation,
  ruleset,
  disabled,
  error,
  onConfirm,
}: LaboratoryPanelProps) {
  const [selectedSamples, setSelectedSamples] = useState<SignalId[]>([])
  const policy = tenderRulesetPolicy(ruleset)
  const [mode, setMode] = useState<'broad' | 'deep' | 'impulse' | null>(
    powerAllocation === 1 ? 'impulse' : policy.versionedLaboratory ? null : 'deep',
  )
  const [firstBroadPair, setFirstBroadPair] = useState<{
    receiverSignal: SignalId
    sourceSignal: SignalId
  } | null>(null)
  const source = selectedSamples[0] ?? null
  const receiver = selectedSamples[1] ?? null
  const isValid = source !== null && receiver !== null && source !== receiver
  const { t } = useI18n()
  const signalName = (signal: SignalId) => t(signalLabelKeys[signal])
  const latestMeasurement = privateMeasurements.at(-1)
  const pairAlreadyResearched = isValid && isLaboratoryPairResearched({
    journal,
    playerId,
    receiverSignal: receiver,
    sourceSignal: source,
  })
  const duplicateBroadPair = mode === 'broad'
    && firstBroadPair !== null
    && isValid
    && areLaboratoryPairsEqual(firstBroadPair, { receiverSignal: receiver, sourceSignal: source })
  const pairError = duplicateBroadPair
    ? 'Вы уже выбрали эту направленную пару. Выберите другую.'
    : pairAlreadyResearched
      ? `Вы уже исследовали ${signalName(source)} → ${signalName(receiver)}. Выберите другую направленную пару.`
      : null

  const handleTest = async () => {
    if (!isValid || mode === null) return
    const pair = { sourceSignal: source, receiverSignal: receiver }
    if (mode === 'broad' && firstBroadPair === null) {
      setFirstBroadPair(pair)
      setSelectedSamples([])
      return
    }
    const succeeded = await runTenderAction(
      () => onConfirm(mode === 'broad'
        ? { mode, pairs: [firstBroadPair!, pair] }
        : { mode, pair }),
    )
    if (succeeded) {
      setFirstBroadPair(null)
      setSelectedSamples([])
    }
  }

  const selectMode = (nextMode: 'broad' | 'deep') => {
    if (mode === nextMode) return
    if (nextMode === 'deep' && firstBroadPair) {
      setSelectedSamples([firstBroadPair.sourceSignal, firstBroadPair.receiverSignal])
      setFirstBroadPair(null)
    }
    setMode(nextMode)
  }

  const handleSampleClick = (signal: SignalId) => {
    setSelectedSamples((current) => {
      if (current.includes(signal)) {
        return current.filter((selected) => selected !== signal)
      }
      if (current.length < 2) {
        return [...current, signal]
      }
      return [signal]
    })
  }

  return (
    <section className={styles.panel} aria-labelledby="laboratory-heading">
      <div className={`${styles.split} ${styles.laboratorySplit}`}>
        <section className={styles.surface}>
          <div className={styles.sectionHeader}>
            <Typography id="laboratory-heading" as="h2" variant="bodySmMedium" className={styles.sectionTitle}>
              Ваши образцы
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{mySamples.length} доступно</Typography>
          </div>

          {powerAllocation === 2 && policy.versionedLaboratory && (
            <div className={styles.laboratoryModeSwitch} role="group" aria-label={t('tender.lab.mode.aria')}>
              <button
                type="button"
                aria-pressed={mode === 'deep'}
                data-selected={mode === 'deep' || undefined}
                disabled={disabled}
                onClick={() => selectMode('deep')}
              >
                <Typography as="span" variant="bodySmMedium">{t('tender.lab.mode.deep')}</Typography>
              </button>
              <button
                type="button"
                aria-pressed={mode === 'broad'}
                data-selected={mode === 'broad' || undefined}
                disabled={disabled}
                onClick={() => selectMode('broad')}
              >
                <Typography as="span" variant="bodySmMedium">{t('tender.lab.mode.broad')}</Typography>
              </button>
            </div>
          )}

          {firstBroadPair && mode === 'broad' && (
            <div className={styles.broadPairSummary}>
              <Typography as="strong" variant="caption">{t('tender.lab.mode.firstPair')}</Typography>
              <Typography as="span" variant="bodySm">
                {signalName(firstBroadPair.sourceSignal)} → {signalName(firstBroadPair.receiverSignal)}
              </Typography>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedSamples([firstBroadPair.sourceSignal, firstBroadPair.receiverSignal])
                  setFirstBroadPair(null)
                }}
              >
                {t('tender.lab.mode.editFirstPair')}
              </Button>
            </div>
          )}

          <div className={styles.choiceMatrix}>
            {mySamples.map((signal) => {
              const role = source === signal ? 'source' : receiver === signal ? 'receiver' : undefined
              const ariaLabel = role === 'source'
                ? t('tender.lab.sourceAria', { signal: signalName(signal) })
                : role === 'receiver'
                  ? t('tender.lab.receiverAria', { signal: signalName(signal) })
                  : t('tender.lab.sampleAria', { signal: signalName(signal) })

              return (
                <button
                  key={signal}
                  type="button"
                  className={styles.sampleChoice}
                  style={signalStyle(signal)}
                  data-selected={role || undefined}
                  data-role={role}
                  aria-label={ariaLabel}
                  aria-pressed={role !== undefined}
                  disabled={disabled}
                  onClick={() => handleSampleClick(signal)}
                >
                  <SignalGlyph signal={signal} className={styles.signalGlyph} />
                  <Typography as="strong" variant="bodySmMedium">{signalName(signal)}</Typography>
                </button>
              )
            })}
          </div>
        </section>

        <section className={styles.surface}>
          <div className={styles.sectionHeader}>
            <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Направленный опыт</Typography>
          </div>

          <div className={styles.experiment}>
            <div className={styles.experimentNode} style={signalStyle(source ?? undefined)}>
              <SignalGlyph signal={source ?? undefined} className={styles.signalGlyph} />
              <Typography as="span" variant="caption" tone="muted">{t('tender.lab.source')}</Typography>
              <Typography as="strong" variant="bodySmMedium">{source ? signalName(source) : 'Не выбран'}</Typography>
            </div>
            <Typography as="span" variant="h4" className={styles.experimentArrow}>→</Typography>
            <div className={styles.experimentNode} style={signalStyle(receiver ?? undefined)}>
              <SignalGlyph signal={receiver ?? undefined} className={styles.signalGlyph} />
              <Typography as="span" variant="caption" tone="muted">{t('tender.lab.receiver')}</Typography>
              <Typography as="strong" variant="bodySmMedium">{receiver ? signalName(receiver) : 'Не выбран'}</Typography>
            </div>
          </div>

          <div className={styles.protocol}>
            <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-hidden="true" />
            <span className={styles.protocolCopy}>
              <Typography as="span" variant="caption" tone="muted">
                {t('tender.lab.protocolLabel', { count: powerAllocation })}
              </Typography>
              <Typography as="strong" variant="bodySmMedium">
                {mode === null
                  ? t('tender.lab.mode.choose')
                  : t(`tender.lab.protocol.${mode === 'deep' ? 'continuous' : 'impulse'}`)}
              </Typography>
            </span>
          </div>

          <div className={styles.laboratoryActions}>
            <div className={styles.privateMeasurement}>
              <span className={styles.privateMeasurementHeader}>
                <span className={styles.privateMeasurementTitle}>
                  <HugeiconsIcon icon={LockIcon} strokeWidth={1.7} aria-hidden="true" />
                  <Typography as="strong" variant="caption">Личные измерения</Typography>
                </span>
                <Typography as="span" variant="caption" tone="muted">Видите только вы</Typography>
              </span>
              {latestMeasurement ? (
                <>
                  <span className={styles.privateMeasurementResult}>
                    <span className={styles.measurementRoute}>
                      <SignalGlyph signal={latestMeasurement.sourceSignal} className={styles.signalGlyph} />
                      <Typography as="strong" variant="caption">{signalName(latestMeasurement.sourceSignal)}</Typography>
                      <Typography as="span" variant="h5" className={styles.measurementArrow}>→</Typography>
                      <SignalGlyph signal={latestMeasurement.receiverSignal} className={styles.signalGlyph} />
                      <Typography as="strong" variant="caption">{signalName(latestMeasurement.receiverSignal)}</Typography>
                    </span>
                    <Typography variant="bodySmMedium" className={styles.measurementRelation}>
                      {latestMeasurement.polarityRelation === 'same' ? 'одинаковая полярность' : 'противоположная полярность'}
                    </Typography>
                  </span>
                  <details className={styles.measurementHistory}>
                    <summary>
                      <Typography as="span" variant="caption">История</Typography>
                      <Typography as="span" variant="caption">{privateMeasurements.length}</Typography>
                    </summary>
                    <div>
                      {privateMeasurements.slice().reverse().map((measurement, index) => (
                        <span
                          key={`${measurement.sourceSignal}-${measurement.receiverSignal}-${index}`}
                          className={styles.measurementHistoryEntry}
                        >
                          <span className={styles.measurementRoute}>
                            <SignalGlyph signal={measurement.sourceSignal} className={styles.measurementHistoryGlyph} />
                            <Typography as="strong" variant="caption">{signalName(measurement.sourceSignal)}</Typography>
                            <Typography as="span" variant="bodySmMedium" className={styles.measurementArrow}>→</Typography>
                            <SignalGlyph signal={measurement.receiverSignal} className={styles.measurementHistoryGlyph} />
                            <Typography as="strong" variant="caption">{signalName(measurement.receiverSignal)}</Typography>
                          </span>
                          <Typography as="span" variant="caption" tone="muted">
                            {measurement.polarityRelation === 'same' ? 'одинаковая полярность' : 'противоположная полярность'}
                          </Typography>
                        </span>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <Typography variant="caption" tone="muted">Появится после первого проведённого опыта.</Typography>
              )}
            </div>

          </div>
        </section>
      </div>

      {(pairError || error) && (
        <div className={styles.error} role="alert">
          <Typography variant="bodySm">{pairError ?? error}</Typography>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.info}>
          <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">
            {source && receiver
              ? `${signalName(source)} → ${signalName(receiver)}`
              : 'Выберите сначала источник, затем приёмник'}
          </Typography>
        </div>
        <Button
          type="button"
          size="lg"
          className={styles.actionButton}
          disabled={disabled || !isValid || mode === null || pairAlreadyResearched || duplicateBroadPair}
          onClick={() => void handleTest()}
        >
          <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-hidden="true" />
          {mode === 'broad' && firstBroadPair === null && source && receiver
            ? t('tender.lab.mode.continueBroad')
            : source && receiver
              ? mode === 'broad'
                ? t('tender.lab.mode.confirmBroad')
                : `Провести опыт: ${signalName(source)} → ${signalName(receiver)}`
            : t('tender.lab.confirm')}
        </Button>
      </footer>
    </section>
  )
}
