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
import { TenderEvidence } from './components/TenderOverview'
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
  evidence: Pick<
    TenderView,
    'privateMeasurements' | 'privateTheses' | 'publicLaboratoryResults' | 'publicTheses'
  >
  error?: string | null
  onConfirm: (model: ScientificModel) => Promise<void>
  onSaveDraft: (draft: ScientificModelDraft) => Promise<void>
  progress?: TenderView['finalScientificModelProgress']
  serverTime: string
  submitted?: boolean
}

const rowStyle = (signal: SignalId) => ({
  '--signal-accent': signalAccent(signal),
} as CSSProperties)

const compactFieldTypeLabels: Record<FieldType, string> = {
  inertial: 'Инерц.',
  electromagnetic: 'ЭМ',
  phase: 'Фаза',
}

const compactPolarityLabels: Record<Polarity, string> = {
  positive: '+ Полож.',
  negative: '− Отриц.',
}

export function FinalScientificModelPanel({
  disabled,
  draft: initialDraft,
  dueAt,
  evidence,
  error,
  onConfirm,
  onSaveDraft,
  progress,
  serverTime,
  submitted,
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
  const formDisabled = disabled || submitted || remainingSeconds === 0
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

  const toggleFieldType = (signal: SignalId, value: FieldType) => {
    const previous = draft.signals
    const current = previous[signal] ?? {}
      const fieldType = current.fieldType === value ? undefined : value
      if (!fieldType && !current.polarity) {
        const next = { ...previous }
        delete next[signal]
        draftController.update({ signals: next })
        return
      }
    draftController.update({ signals: { ...previous, [signal]: { ...current, fieldType } } })
  }

  const togglePolarity = (signal: SignalId, value: Polarity) => {
    const previous = draft.signals
    const current = previous[signal] ?? {}
      const polarity = current.polarity === value ? undefined : value
      if (!current.fieldType && !polarity) {
        const next = { ...previous }
        delete next[signal]
        draftController.update({ signals: next })
        return
      }
    draftController.update({ signals: { ...previous, [signal]: { ...current, polarity } } })
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
                Ваша финальная модель
              </Typography>
              <Typography variant="bodySm" className={styles.description}>
                Ваши гипотезы видите только вы до завершения тендера.
              </Typography>
            </span>
            <span className={styles.modelProgress} aria-label={`Заполнено параметров: ${propertyCount} из 12`}>
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
          {!submitted && remainingSeconds <= 30 && (
            <div className={styles.warning} role="alert">
              <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
              <Typography variant="bodySm">
                {remainingSeconds <= 10
                  ? t('tender.finalDraft.warningCritical')
                  : t('tender.finalDraft.warning')}
              </Typography>
            </div>
          )}

          <a className={styles.finalEvidenceSummary} href="#final-evidence">
            <span>
              <Typography as="strong" variant="bodySmMedium">Данные для решения</Typography>
              <Typography as="span" variant="caption" tone="muted">
                {evidence.publicLaboratoryResults.length} публичных опытов ·{' '}
                {evidence.privateMeasurements.length} личных измерений ·{' '}
                {(evidence.privateTheses?.length ?? 0) + evidence.publicTheses.length} тезисов
              </Typography>
            </span>
            <Typography as="span" variant="control">К данным ↓</Typography>
          </a>

          <div className={styles.finalModelTable}>
            <div className={styles.finalModelHead} aria-hidden="true">
              <Typography as="span" variant="caption">Сигнал</Typography>
              <Typography as="span" variant="caption">Тип поля</Typography>
              <Typography as="span" variant="caption">Полярность</Typography>
            </div>

            {signalIds.map((signal) => {
              const claim = model[signal]
              const signalName = t(signalLabelKeys[signal])
              return (
                <div key={signal} className={styles.modelRow} style={rowStyle(signal)}>
                  <span className={styles.modelSignal}>
                    <SignalGlyph signal={signal} className={styles.signalGlyph} />
                    <Typography as="strong" variant="bodySmMedium">{signalName}</Typography>
                  </span>

                  <div className={styles.segmented}>
                    {fieldTypes.map((fieldType) => (
                      <button
                        aria-label={`${signalName}: тип поля ${t(fieldTypeLabelKeys[fieldType])}`}
                        aria-pressed={claim?.fieldType === fieldType}
                        key={fieldType}
                        type="button"
                        disabled={formDisabled}
                        data-selected={claim?.fieldType === fieldType ? '' : undefined}
                        onClick={() => toggleFieldType(signal, fieldType)}
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

                  <div className={styles.segmented} data-options="2">
                    {polarities.map((polarity) => (
                      <button
                        aria-label={`${signalName}: полярность ${t(polarityLabelKeys[polarity])}`}
                        aria-pressed={claim?.polarity === polarity}
                        key={polarity}
                        type="button"
                        disabled={formDisabled}
                        data-selected={claim?.polarity === polarity ? '' : undefined}
                        onClick={() => togglePolarity(signal, polarity)}
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
                </div>
              )
            })}
          </div>
        </div>

        <aside className={styles.finalSidebar}>
          <section className={styles.surface} id="final-evidence">
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Данные для анализа</Typography>
              <Typography asChild variant="control">
                <a className={styles.finalBackLink} href="#final-model-heading">К модели ↑</a>
              </Typography>
            </div>
            <TenderEvidence data={evidence} compactLaboratoryInsets laboratoryCountBelowResults />
          </section>
          <section className={styles.surface}>
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Прогресс</Typography>
            </div>
            <div className={styles.finalProgressList}>
              <span>
                <Typography as="strong" variant="bodySmMedium">{propertyCount} / 12</Typography>
                <Typography as="span" variant="caption" tone="muted">свойств заполнено</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">{completeCount} / 6</Typography>
                <Typography as="span" variant="caption" tone="muted">сигналов готовы</Typography>
              </span>
            </div>
          </section>

          <section className={styles.surface}>
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Подсчёт</Typography>
            </div>
            <div className={styles.scoringRules}>
              <span>
                <Typography as="strong" variant="bodySmMedium">+1</Typography>
                <Typography as="span" variant="caption">за верный тип поля</Typography>
                <Typography as="small" variant="caption">макс. 6</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">+1</Typography>
                <Typography as="span" variant="caption">за верную полярность</Typography>
                <Typography as="small" variant="caption">макс. 6</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">+1</Typography>
                <Typography as="span" variant="caption">за оба свойства сигнала</Typography>
                <Typography as="small" variant="caption">макс. 6</Typography>
              </span>
              <span>
                <Typography as="strong" variant="bodySmMedium">+3</Typography>
                <Typography as="span" variant="caption">за полную конфигурацию</Typography>
                <Typography as="small" variant="caption">макс. 3</Typography>
              </span>
              <span className={styles.maximum}>
                <Typography as="b" variant="bodySmMedium">Максимум</Typography>
                <Typography as="strong" variant="bodySmMedium">21</Typography>
              </span>
            </div>
          </section>

          <div className={styles.warning}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm">
              Отправка необратима. Незаполненные параметры не принесут рейтинг.
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

      <footer className={styles.footer}>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">
            Полностью верная модель даёт дополнительный бонус +3.
          </Typography>
        </div>
        <Button
          type="button"
          size="lg"
          className={styles.actionButton}
          disabled={formDisabled || claimedCount === 0}
          onClick={() => void handleSubmit()}
        >
          {submitted
            ? t('tender.finalDraft.submitted')
            : claimedCount === 0
              ? 'Укажите хотя бы одно свойство'
              : 'Отправить финальную модель'}
        </Button>
      </footer>
    </section>
  )
}
