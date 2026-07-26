import { InformationCircleIcon, LockIcon, TestTube01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { LaboratoryProtocol, SignalId, TenderView } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from './catalog'
import styles from './components/PhasePanel.module.css'
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'
import { runTenderAction } from './run-tender-action'

type LaboratoryPanelProps = {
  mySamples: SignalId[]
  privateMeasurements: TenderView['privateMeasurements']
  powerAllocation: number
  disabled?: boolean
  error?: string | null
  onConfirm: (input: { sourceSignal: SignalId; receiverSignal: SignalId; protocol: LaboratoryProtocol }) => Promise<void>
}

const signalStyle = (signal?: SignalId) => ({
  '--signal-accent': signal ? signalAccent(signal) : '#64788c',
} as CSSProperties)

export function LaboratoryPanel({
  mySamples,
  privateMeasurements,
  powerAllocation,
  disabled,
  error,
  onConfirm,
}: LaboratoryPanelProps) {
  const [source, setSource] = useState<SignalId | null>(null)
  const [receiver, setReceiver] = useState<SignalId | null>(null)
  const protocol: LaboratoryProtocol = powerAllocation >= 2 ? 'continuous' : 'impulse'
  const isValid = source !== null && receiver !== null && source !== receiver
  const { t } = useI18n()
  const signalName = (signal: SignalId) => t(signalLabelKeys[signal])
  const latestMeasurement = privateMeasurements.at(-1)

  const handleTest = async () => {
    if (!isValid) return
    const succeeded = await runTenderAction(
      () => onConfirm({ sourceSignal: source, receiverSignal: receiver, protocol }),
    )
    if (succeeded) {
      setSource(null)
      setReceiver(null)
    }
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

          <div className={styles.choiceMatrix}>
            {mySamples.map((signal) => (
              <div key={signal} className={styles.sampleChoice} style={signalStyle(signal)}>
                <SignalGlyph signal={signal} className={styles.signalGlyph} />
                <Typography as="strong" variant="bodySmMedium">{signalName(signal)}</Typography>
                <span className={styles.roleButtons}>
                  <button
                    type="button"
                    className={styles.roleButton}
                    data-selected={source === signal || undefined}
                    aria-label={t('tender.lab.sourceAria', { signal: signalName(signal) })}
                    disabled={disabled}
                    onClick={() => {
                      setSource(source === signal ? null : signal)
                      if (receiver === signal) setReceiver(null)
                    }}
                  >
                    <Typography as="span" variant="caption">И</Typography>
                  </button>
                  {source !== signal ? (
                    <button
                      type="button"
                      className={styles.roleButton}
                      data-selected={receiver === signal || undefined}
                      aria-label={t('tender.lab.receiverAria', { signal: signalName(signal) })}
                      disabled={disabled}
                      onClick={() => setReceiver(receiver === signal ? null : signal)}
                    >
                      <Typography as="span" variant="caption">П</Typography>
                    </button>
                  ) : (
                    <span className={styles.roleButton} aria-hidden="true">
                      <Typography as="span" variant="caption">П</Typography>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className={`${styles.info} mt-3`}>
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm">И — источник, П — приёмник. Один сигнал нельзя использовать дважды.</Typography>
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
              <Typography as="span" variant="caption" tone="muted">Протокол · {powerAllocation} мощности</Typography>
              <Typography as="strong" variant="bodySmMedium">
                {t(`tender.lab.protocol.${protocol}`)}
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

            <Button
              type="button"
              size="lg"
              className={styles.laboratoryActionButton}
              disabled={disabled || !isValid}
              onClick={() => void handleTest()}
            >
              <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-hidden="true" />
              {source && receiver
                ? `Провести опыт: ${signalName(source)} → ${signalName(receiver)}`
                : t('tender.lab.confirm')}
            </Button>
          </div>
        </section>
      </div>

      {error && <div className={styles.error} role="alert"><Typography variant="bodySm">{error}</Typography></div>}
    </section>
  )
}
