import { translate } from '../../platform/i18n'
import { Alert01Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'

import type {
  FieldType,
  Polarity,
  ScientificModel,
  ScientificModelDraft,
  SignalId,
  TenderView,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { useSynchronizedCountdown } from '@/platform/time/synchronized-countdown'
import {
  fieldTypeLabelKeys,
  fieldTypes,
  polarities,
  polarityLabelKeys,
  signalIds,
  signalLabelKeys,
} from './catalog'
import styles from './components/PhasePanel.module.css'
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'
import { runTenderAction } from './run-tender-action'
import {
  WorkingModelDraftController,
  type WorkingModelSaveStatus,
} from './working-model-draft'

type Props = {
  disabled?: boolean
  draft: ScientificModelDraft
  dueAt: string | null
  error?: string | null
  onConfirm: (model: ScientificModel) => Promise<void>
  onSaveDraft: (draft: ScientificModelDraft) => Promise<void>
  progress?: TenderView['finalScientificModelProgress']
  serverTime: string
  submitted?: boolean
  untimed?: boolean
}

const rowStyle = (signal: SignalId) => ({
  '--signal-accent': signalAccent(signal),
} as CSSProperties)

const compactFieldTypeLabels: Record<FieldType, string> = {
  inertial: translate('tender.finalScientificModelPanel.copy.001'),
  electromagnetic: translate('tender.finalScientificModelPanel.copy.002'),
  phase: translate('tender.finalScientificModelPanel.copy.003'),
}

const compactPolarityLabels: Record<Polarity, string> = {
  positive: translate('tender.finalScientificModelPanel.copy.004'),
  negative: translate('tender.finalScientificModelPanel.copy.005'),
}

export function FinalScientificModelPanel({
  disabled,
  draft: initialDraft,
  dueAt,
  error,
  onConfirm,
  onSaveDraft,
  progress,
  serverTime,
  submitted,
  untimed = false,
}: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<ScientificModelDraft>(initialDraft)
  const [saveStatus, setSaveStatus] = useState<WorkingModelSaveStatus>({ state: 'idle' })
  const [draftController] = useState(() => new WorkingModelDraftController<ScientificModelDraft>({
    cancel: (timer) => clearTimeout(timer),
    errorMessage: t('tender.finalDraft.saveError'),
    initialModel: initialDraft,
    onDraft: setDraft,
    onStatus: setSaveStatus,
    save: onSaveDraft,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  }))
  const remainingSeconds = useSynchronizedCountdown(dueAt, serverTime, { maximumSeconds: 180 })
  const formDisabled = disabled || submitted || (!untimed && remainingSeconds === 0)
  const model = draft.signals

  useEffect(() => {
    draftController.setSave(onSaveDraft)
  }, [draftController, onSaveDraft])

  useEffect(() => {
    draftController.receiveServerModel(initialDraft)
  }, [draftController, initialDraft])

  useEffect(() => {
    draftController.resume()
    return () => {
      void draftController.dispose()
    }
  }, [draftController])

  const setFieldType = (signal: SignalId, value: FieldType | undefined) => {
    const previous = draft.signals
    const current = previous[signal] ?? {}
    if (!value && !current.polarity) {
      const next = { ...previous }
      delete next[signal]
      draftController.update({ signals: next })
      return
    }
    draftController.update({ signals: { ...previous, [signal]: { ...current, fieldType: value } } })
  }

  const setPolarity = (signal: SignalId, value: Polarity | undefined) => {
    const previous = draft.signals
    const current = previous[signal] ?? {}
    if (!current.fieldType && !value) {
      const next = { ...previous }
      delete next[signal]
      draftController.update({ signals: next })
      return
    }
    draftController.update({ signals: { ...previous, [signal]: { ...current, polarity: value } } })
  }

  const handleSubmit = async () => {
    if (Object.keys(model).length > 0) {
      await draftController.flush()
      await runTenderAction(() => onConfirm({ signals: model }))
    }
  }

  const claimedCount = Object.values(model).filter((claim) => claim.fieldType || claim.polarity).length
  const completeCount = Object.values(model).filter((claim) => claim.fieldType && claim.polarity).length
  const propertyCount = Object.values(model).reduce(
    (total, claim) => total + Number(Boolean(claim.fieldType)) + Number(Boolean(claim.polarity)),
    0,
  )

  return (
    <section className={styles.panel} aria-labelledby="final-model-heading">
      <div className={styles.finalWorkspace}>
        <div className={styles.surface}>
          <div className={styles.sectionHeader}>
            <span className={styles.intro}>
              <Typography id="final-model-heading" as="h2" variant="bodySmMedium" className={styles.title}>
                
                {translate('tender.finalScientificModelPanel.copy.006')}
              </Typography>
              <Typography variant="bodySm" className={styles.description}>
                
                {translate('tender.finalScientificModelPanel.copy.007')}
              </Typography>
            </span>
            <span className={styles.modelProgress} aria-label={translate('tender.finalScientificModelPanel.copy.008', { value1: propertyCount })}>
              <Typography as="strong" variant="bodySmMedium">{propertyCount}</Typography>
              <Typography as="span" variant="caption">/ 12</Typography>
            </span>
          </div>
          {progress && (
            <Typography variant="bodySm" tone="muted">
              {t('tender.finalDraft.progress', {
                completed: progress.completed,
                total: progress.total,
              })}
            </Typography>
          )}
          {submitted && (
            <div className={styles.info} role="status">
              <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
              <Typography variant="bodySm">{t('tender.finalDraft.submitted')}</Typography>
            </div>
          )}
          {!untimed && !submitted && remainingSeconds <= 30 && (
            <div className={styles.warning} role="alert">
              <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
              <Typography variant="bodySm">
                {remainingSeconds <= 10
                  ? t('tender.finalDraft.warningCritical')
                  : t('tender.finalDraft.warning')}
              </Typography>
            </div>
          )}

          <div className={styles.finalModelTable}>
            <div className={styles.finalModelHead} aria-hidden="true">
              <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.009')}</Typography>
              <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.010')}</Typography>
              <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.011')}</Typography>
            </div>

            {signalIds.map((signal) => {
              const claim = model[signal]
              const signalName = t(signalLabelKeys[signal])
              return (
                <div
                  key={signal}
                  className={styles.modelRow}
                  style={rowStyle(signal)}
                  data-final-model-signal-row=""
                >
                  <span className={styles.modelSignal}>
                    <SignalGlyph signal={signal} className={styles.signalGlyph} />
                    <Typography as="strong" variant="bodySmMedium">{signalName}</Typography>
                  </span>

                  <div className={`${styles.segmented} ${styles.finalDesktopControl}`}>
                    {fieldTypes.map((fieldType) => (
                      <button
                        aria-label={translate('tender.finalScientificModelPanel.copy.012', { value1: signalName, value2: t(fieldTypeLabelKeys[fieldType]) })}
                        aria-pressed={claim?.fieldType === fieldType}
                        key={fieldType}
                        type="button"
                        disabled={formDisabled}
                        data-selected={claim?.fieldType === fieldType ? '' : undefined}
                        onClick={() => setFieldType(
                          signal,
                          claim?.fieldType === fieldType ? undefined : fieldType,
                        )}
                      >
                        <Typography as="span" variant="caption" className={styles.finalOptionLong}>
                          {t(fieldTypeLabelKeys[fieldType])}
                        </Typography>
                        <Typography as="span" variant="caption" className={styles.finalOptionShort} aria-hidden="true">
                          {compactFieldTypeLabels[fieldType]}
                        </Typography>
                      </button>
                    ))}
                  </div>

                  <div className={`${styles.segmented} ${styles.finalDesktopControl}`} data-options="2">
                    {polarities.map((polarity) => (
                      <button
                        aria-label={translate('tender.finalScientificModelPanel.copy.013', { value1: signalName, value2: t(polarityLabelKeys[polarity]) })}
                        aria-pressed={claim?.polarity === polarity}
                        key={polarity}
                        type="button"
                        disabled={formDisabled}
                        data-selected={claim?.polarity === polarity ? '' : undefined}
                        onClick={() => setPolarity(
                          signal,
                          claim?.polarity === polarity ? undefined : polarity,
                        )}
                      >
                        <Typography as="span" variant="caption" className={styles.finalOptionLong}>
                          {`${polarity === 'positive' ? '+' : '−'} ${t(polarityLabelKeys[polarity])}`}
                        </Typography>
                        <Typography as="span" variant="caption" className={styles.finalOptionShort} aria-hidden="true">
                          {compactPolarityLabels[polarity]}
                        </Typography>
                      </button>
                    ))}
                  </div>

                  <div className={styles.finalMobileControls} data-final-model-mobile-controls="">
                    <label className={styles.finalMobileControl}>
                      <Typography as="span" variant="caption" tone="muted">{translate('tender.finalScientificModelPanel.copy.014')}</Typography>
                      <NativeSelect
                        size="sm"
                        aria-label={translate('tender.finalScientificModelPanel.copy.015', { value1: signalName })}
                        data-final-model-mobile-select=""
                        disabled={formDisabled}
                        value={claim?.fieldType ?? ''}
                        onChange={(event) => setFieldType(
                          signal,
                          event.currentTarget.value === ''
                            ? undefined
                            : event.currentTarget.value as FieldType,
                        )}
                      >
                        <NativeSelectOption value="">{translate('tender.finalScientificModelPanel.copy.016')}</NativeSelectOption>
                        {fieldTypes.map((fieldType) => (
                          <NativeSelectOption value={fieldType} key={fieldType}>
                            {t(fieldTypeLabelKeys[fieldType])}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className={styles.finalMobileControl}>
                      <Typography as="span" variant="caption" tone="muted">{translate('tender.finalScientificModelPanel.copy.017')}</Typography>
                      <NativeSelect
                        size="sm"
                        aria-label={translate('tender.finalScientificModelPanel.copy.018', { value1: signalName })}
                        data-final-model-mobile-select=""
                        disabled={formDisabled}
                        value={claim?.polarity ?? ''}
                        onChange={(event) => setPolarity(
                          signal,
                          event.currentTarget.value === ''
                            ? undefined
                            : event.currentTarget.value as Polarity,
                        )}
                      >
                        <NativeSelectOption value="">{translate('tender.finalScientificModelPanel.copy.019')}</NativeSelectOption>
                        {polarities.map((polarity) => (
                          <NativeSelectOption value={polarity} key={polarity}>
                            {t(polarityLabelKeys[polarity])}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <aside className={styles.finalSidebar}>
          <section className={styles.surface}>
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.finalScientificModelPanel.copy.020')}</Typography>
            </div>
            <div className={styles.finalProgressList}>
              <span>
                <Typography as="strong" variant="bodySmMedium">{propertyCount} / 12</Typography>
                <Typography as="span" variant="caption" tone="muted">{translate('tender.finalScientificModelPanel.copy.021')}</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">{completeCount} / 6</Typography>
                <Typography as="span" variant="caption" tone="muted">{translate('tender.finalScientificModelPanel.copy.022')}</Typography>
              </span>
            </div>
          </section>

          <section className={styles.surface}>
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>{translate('tender.finalScientificModelPanel.copy.023')}</Typography>
            </div>
            <div className={styles.scoringRules}>
              <span>
                <Typography as="strong" variant="bodySmMedium">+1</Typography>
                <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.024')}</Typography>
                <Typography as="small" variant="caption">{translate('tender.finalScientificModelPanel.copy.025')}</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">+1</Typography>
                <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.026')}</Typography>
                <Typography as="small" variant="caption">{translate('tender.finalScientificModelPanel.copy.027')}</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">+1</Typography>
                <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.028')}</Typography>
                <Typography as="small" variant="caption">{translate('tender.finalScientificModelPanel.copy.029')}</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">+3</Typography>
                <Typography as="span" variant="caption">{translate('tender.finalScientificModelPanel.copy.030')}</Typography>
                <Typography as="small" variant="caption">{translate('tender.finalScientificModelPanel.copy.031')}</Typography>
              </span>
              <span className={styles.maximum}>
                <Typography as="b" variant="bodySmMedium">{translate('tender.finalScientificModelPanel.copy.032')}</Typography>
                <Typography as="strong" variant="bodySmMedium">21</Typography>
              </span>
            </div>
          </section>

          <div className={styles.warning}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm">
              
              {translate('tender.finalScientificModelPanel.copy.033')}
            </Typography>
          </div>
        </aside>
      </div>

      {error && <div className={styles.error} role="alert"><Typography variant="bodySm">{error}</Typography></div>}
      {saveStatus.state === 'saving' && (
        <Typography variant="caption" tone="muted" role="status">{t('tender.finalDraft.saving')}</Typography>
      )}
      {saveStatus.state === 'error' && (
        <div className={styles.error} role="alert"><Typography variant="bodySm">{saveStatus.message}</Typography></div>
      )}

      <footer className={`${styles.footer} ${styles.finalFooter}`}>
        <Button
          type="button"
          size="lg"
          className={styles.actionButton}
          data-tutorial-final-submit=""
          disabled={formDisabled || claimedCount === 0}
          onClick={() => void handleSubmit()}
        >
          {submitted
            ? t('tender.finalDraft.submitted')
            : claimedCount === 0
              ? translate('tender.finalScientificModelPanel.copy.034')
              : translate('tender.finalScientificModelPanel.copy.035')}
        </Button>
      </footer>
    </section>
  )
}
