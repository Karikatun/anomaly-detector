import { Alert01Icon, InformationCircleIcon, SignalFullIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type {
  FieldType,
  Polarity,
  PublicThesis,
  SignalId,
  WorkingModel,
  TenderView,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import {
  fieldTypeLabelKeys,
  fieldTypes,
  polarities,
  polarityLabelKeys,
  signalLabelKeys,
} from './catalog'
import styles from './components/PhasePanel.module.css'
import { SignalGlyph } from './components/SignalGlyph'
import { signalAccent } from './components/signal-visuals'
import { WorkingModelWorkspace } from './components/WorkingModelWorkspace'
import { TenderEvidence } from './components/TenderOverview'
import { runTenderAction } from './run-tender-action'

type ModelAnalysisPanelProps = {
  knownSignals: SignalId[]
  maxTheses: number
  model: WorkingModel
  publicTheses: PublicThesis[]
  publicLaboratoryResults: TenderView['publicLaboratoryResults']
  privateMeasurements: TenderView['privateMeasurements']
  disabled?: boolean
  workingModelDisabled?: boolean
  error?: string | null
  onConfirmThesis: (input: { signalId: SignalId; fieldType: FieldType; polarity: Polarity }) => Promise<void>
  onSaveWorkingModel: (model: WorkingModel) => Promise<void>
}

const previewStyle = (signal?: SignalId) => ({
  '--signal-accent': signal ? signalAccent(signal) : '#64788c',
} as CSSProperties)

export function ModelAnalysisPanel({
  knownSignals,
  maxTheses,
  model,
  publicTheses,
  publicLaboratoryResults,
  privateMeasurements,
  disabled,
  workingModelDisabled,
  error,
  onConfirmThesis,
  onSaveWorkingModel,
}: ModelAnalysisPanelProps) {
  const [signalId, setSignalId] = useState<SignalId | ''>('')
  const [fieldType, setFieldType] = useState<FieldType | ''>('')
  const [polarity, setPolarity] = useState<Polarity | ''>('')
  const { t } = useI18n()
  const isValid = signalId !== '' && fieldType !== '' && polarity !== ''

  const handleSubmit = async () => {
    if (!isValid) return
    const succeeded = await runTenderAction(
      () => onConfirmThesis({ signalId, fieldType, polarity }),
    )
    if (succeeded) {
      setFieldType('')
      setPolarity('')
    }
  }

  return (
    <section className={`${styles.panel} ${styles.analysisPanel}`} aria-labelledby="analysis-heading">
      <div className={styles.analysisSplit}>
        <section className={`${styles.surface} ${styles.analysisModel}`}>
          <div className={styles.sectionHeader}>
            <Typography id="analysis-heading" as="h2" variant="bodySmMedium" className={styles.sectionTitle}>
              Рабочая модель
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>Видите только вы</Typography>
          </div>
          <WorkingModelWorkspace
            disabled={workingModelDisabled}
            inlineOnDesktop
            knownSignals={knownSignals}
            model={model}
            onSave={onSaveWorkingModel}
          />
        </section>

        <section className={`${styles.surface} ${styles.analysisThesis}`}>
          <div className={styles.sectionHeader}>
            <Typography as="h2" variant="bodySmMedium" className={styles.sectionTitle}>
              Публичный тезис
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>Видят все</Typography>
          </div>

          <div className={styles.analysisFormGrid}>
            <label className={styles.field}>
              <Typography as="span" variant="caption" tone="muted">{t('tender.analysis.signal')}</Typography>
              <NativeSelect
                aria-label={t('tender.analysis.signalAria')}
                disabled={disabled}
                value={signalId}
                onChange={(event) => setSignalId(event.target.value as SignalId | '')}
              >
                <option value="">{t('tender.analysis.signalPlaceholder')}</option>
                {knownSignals.map((signal) => (
                  <option key={signal} value={signal}>{t(signalLabelKeys[signal])}</option>
                ))}
              </NativeSelect>
            </label>

            <label className={styles.field}>
              <Typography as="span" variant="caption" tone="muted">{t('tender.analysis.fieldType')}</Typography>
              <NativeSelect
                aria-label={t('tender.analysis.fieldTypeAria')}
                disabled={disabled}
                value={fieldType}
                onChange={(event) => setFieldType(event.target.value as FieldType | '')}
              >
                <option value="">{t('tender.analysis.fieldTypePlaceholder')}</option>
                {fieldTypes.map((type) => (
                  <option key={type} value={type}>{t(fieldTypeLabelKeys[type])}</option>
                ))}
              </NativeSelect>
            </label>

            <label className={styles.field}>
              <Typography as="span" variant="caption" tone="muted">{t('tender.analysis.polarity')}</Typography>
              <NativeSelect
                aria-label={t('tender.analysis.polarityAria')}
                disabled={disabled}
                value={polarity}
                onChange={(event) => setPolarity(event.target.value as Polarity | '')}
              >
                <option value="">{t('tender.analysis.polarityPlaceholder')}</option>
                {polarities.map((value) => (
                  <option key={value} value={value}>{t(polarityLabelKeys[value])}</option>
                ))}
              </NativeSelect>
            </label>
          </div>

          <div className={styles.preview} style={previewStyle(signalId || undefined)}>
            <SignalGlyph signal={signalId || undefined} className={styles.signalGlyph} />
            <span className={styles.previewCopy}>
              <Typography as="strong" variant="bodySmMedium">
                {signalId ? t(signalLabelKeys[signalId]) : 'Выберите сигнал'}
              </Typography>
              <Typography variant="bodySm" tone="muted">
                {fieldType ? t(fieldTypeLabelKeys[fieldType]) : 'Тип поля не выбран'}
                {' · '}
                {polarity ? t(polarityLabelKeys[polarity]) : 'полярность не выбрана'}
              </Typography>
            </span>
          </div>

          <div className={styles.warning}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm">
              Верный тезис: +1 рейтинг и сертификация. Неверный запускает корпоративную проверку.
            </Typography>
          </div>
          <details className={styles.analysisEvidence}>
            <summary>
              <Typography as="span" variant="bodySmMedium">История лаборатории</Typography>
              <Typography as="span" variant="caption">
                {publicLaboratoryResults.length + privateMeasurements.length}
              </Typography>
            </summary>
            <TenderEvidence
              data={{
                privateMeasurements,
                publicLaboratoryResults,
                publicTheses: [],
              }}
            />
          </details>
          <div className={styles.analysisHistory}>
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>История тезисов</Typography>
              <Typography as="span" variant="caption" className={styles.sectionMeta}>{publicTheses.length}</Typography>
            </div>
            {publicTheses.length === 0 ? (
              <Typography variant="bodySm" tone="muted">В этом тендере тезисов ещё нет.</Typography>
            ) : (
              <div className={styles.journalList}>
                {publicTheses.slice().reverse().map((thesis, index) => (
                  <div
                    key={`${thesis.playerId}-${thesis.signalId}-${index}`}
                    className={styles.journalEntry}
                    data-public-thesis
                    style={previewStyle(thesis.signalId)}
                  >
                    <SignalGlyph signal={thesis.signalId} className={styles.signalGlyph} />
                    <span className={styles.signalCopy}>
                      <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[thesis.signalId])}</Typography>
                      <Typography as="span" variant="caption" tone="muted">
                        {t(fieldTypeLabelKeys[thesis.fieldType])} · {t(polarityLabelKeys[thesis.polarity])}
                      </Typography>
                    </span>
                    <span className={styles.journalMeta}>
                      <Typography as="span" variant="caption">{thesis.correct ? 'Верно' : 'Неверно'}</Typography>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {error && <div className={styles.error} role="alert"><Typography variant="bodySm">{error}</Typography></div>}

      <footer className={styles.footer}>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">
            Тезис публичен и необратим.{maxTheses > 1 ? ' Доступна расширенная проверка.' : ''}
          </Typography>
        </div>
        <Button
          type="button"
          size="lg"
          className={styles.actionButton}
          disabled={disabled || !isValid}
          onClick={() => void handleSubmit()}
        >
          <HugeiconsIcon icon={SignalFullIcon} strokeWidth={1.7} aria-hidden="true" />
          {t('tender.analysis.submit')}
        </Button>
      </footer>
    </section>
  )
}
