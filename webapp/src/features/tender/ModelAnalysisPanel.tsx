import { translate } from '../../platform/i18n'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { runTenderAction } from './run-tender-action'
import type { WorkingModelSaveStatus } from './working-model-draft'
import { tenderRulesetPolicy } from './ruleset-policy'

type ModelAnalysisPanelProps = {
  knownSignals: SignalId[]
  maxTheses: number
  model: WorkingModel
  publicTheses: PublicThesis[]
  privateTheses?: TenderView['privateTheses']
  progress?: TenderView['modelAnalysisProgress']
  round: number
  ruleset?: TenderView['ruleset']
  disabled?: boolean
  workingModelDisabled?: boolean
  workingModelDialog?: {
    onOpenChange: (open: boolean) => void
    onSaveStatusChange: (status: WorkingModelSaveStatus) => void
    open: boolean
    openDisabled: boolean
  }
  workingModelSignals?: SignalId[]
  error?: string | null
  onConfirmThesis: (input: { signalId: SignalId; fieldType: FieldType; polarity: Polarity }) => Promise<void>
  onFinish: () => Promise<void>
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
  privateTheses,
  progress,
  round,
  ruleset,
  disabled,
  workingModelDisabled,
  workingModelDialog,
  workingModelSignals = knownSignals,
  error,
  onConfirmThesis,
  onFinish,
  onSaveWorkingModel,
}: ModelAnalysisPanelProps) {
  const [signalId, setSignalId] = useState<SignalId | ''>('')
  const [fieldType, setFieldType] = useState<FieldType | ''>('')
  const [polarity, setPolarity] = useState<Polarity | ''>('')
  const { t } = useI18n()
  const isValid = signalId !== '' && fieldType !== '' && polarity !== ''
  const isPrivateAnalysis = tenderRulesetPolicy(ruleset).sharedModelAnalysis
  const privateThesisHistory = privateTheses ?? []
  const currentRoundPrivateTheses = privateThesisHistory.filter((thesis) => thesis.round === round)
  const visibleTheses = isPrivateAnalysis
    ? privateThesisHistory
    : publicTheses

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
              
              {translate('tender.modelAnalysisPanel.copy.001')}
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{translate('tender.modelAnalysisPanel.copy.002')}</Typography>
          </div>
          <WorkingModelWorkspace
            disabled={workingModelDisabled}
            inlineOnDesktop
            knownSignals={workingModelSignals}
            model={model}
            onSave={onSaveWorkingModel}
            {...workingModelDialog}
          />
        </section>

        <section className={`${styles.surface} ${styles.analysisThesis}`}>
          <div className={styles.sectionHeader}>
            <Typography as="h2" variant="bodySmMedium" className={styles.sectionTitle}>
              {isPrivateAnalysis ? t('tender.analysis.privateTitle') : t('tender.analysis.publicTitle')}
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>
              {isPrivateAnalysis ? t('tender.analysis.privateMeta') : t('tender.analysis.publicMeta')}
            </Typography>
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
                {signalId ? t(signalLabelKeys[signalId]) : translate('tender.modelAnalysisPanel.copy.003')}
              </Typography>
              <Typography variant="bodySm" tone="muted">
                {fieldType ? t(fieldTypeLabelKeys[fieldType]) : translate('tender.modelAnalysisPanel.copy.004')}
                {' · '}
                {polarity ? t(polarityLabelKeys[polarity]) : translate('tender.modelAnalysisPanel.copy.005')}
              </Typography>
            </span>
          </div>

          <div className={styles.warning}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm">
              {isPrivateAnalysis
                ? t('tender.analysis.privateWarning')
                : t('tender.analysis.publicWarning')}
            </Typography>
          </div>
          <div className={styles.analysisHistory}>
            <div className={styles.sectionHeader}>
              <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>
                {t('tender.analysis.history')}
              </Typography>
              <Typography as="span" variant="caption" className={styles.sectionMeta}>
                {isPrivateAnalysis
                  ? t('tender.analysis.historyCount', {
                      current: currentRoundPrivateTheses.length,
                      max: maxTheses,
                      total: visibleTheses.length,
                    })
                  : `${visibleTheses.length} / ${maxTheses}`}
              </Typography>
            </div>
            {visibleTheses.length === 0 ? (
              <Typography variant="bodySm" tone="muted">{t('tender.analysis.historyEmpty')}</Typography>
            ) : (
              <div className={styles.journalList}>
                {visibleTheses.slice().reverse().map((thesis, index) => {
                  const fieldTypeCorrect = 'fieldTypeCorrect' in thesis ? thesis.fieldTypeCorrect : thesis.correct
                  const polarityCorrect = 'polarityCorrect' in thesis ? thesis.polarityCorrect : thesis.correct
                  return (
                  <div
                    key={'id' in thesis ? thesis.id : `${thesis.playerId}-${thesis.signalId}-${index}`}
                    className={styles.journalEntry}
                    data-private-thesis={isPrivateAnalysis || undefined}
                    data-public-thesis={!isPrivateAnalysis || undefined}
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
                      <Typography as="span" variant="caption" data-correct={fieldTypeCorrect || undefined}>
                        {fieldTypeCorrect ? t('tender.analysis.typeCorrect') : t('tender.analysis.typeIncorrect')}
                      </Typography>
                      <Typography as="span" variant="caption" data-correct={polarityCorrect || undefined}>
                        {polarityCorrect ? t('tender.analysis.polarityCorrect') : t('tender.analysis.polarityIncorrect')}
                      </Typography>
                    </span>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
          {isPrivateAnalysis && progress && (
            <Typography variant="bodySm" tone="muted">
              {t('tender.analysis.progress', {
                completed: progress.completed,
                total: progress.total,
              })}
            </Typography>
          )}
        </section>
      </div>

      {error && <div className={styles.error} role="alert"><Typography variant="bodySm">{error}</Typography></div>}

      <footer className={styles.footer}>
        <div className={styles.info}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography variant="bodySm">
            {isPrivateAnalysis
              ? t('tender.analysis.privateInfo')
              : t('tender.analysis.publicInfo')}
          </Typography>
        </div>
        {isPrivateAnalysis && maxTheses === 2 && currentRoundPrivateTheses.length === 1 && !disabled && (
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" size="lg" variant="outline">
                {t('tender.analysis.finishEarly')}
              </Button>
            </DialogTrigger>
            <DialogContent closeLabel={t('tender.analysis.finishCancel')}>
              <DialogHeader>
                <DialogTitle>{t('tender.analysis.finishTitle')}</DialogTitle>
                <DialogDescription>{t('tender.analysis.finishDescription')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">{t('tender.analysis.finishCancel')}</Button>
                </DialogClose>
                <Button type="button" onClick={() => void runTenderAction(onFinish)}>
                  {t('tender.analysis.finishConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
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
