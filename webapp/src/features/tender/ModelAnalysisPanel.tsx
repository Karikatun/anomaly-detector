import { Alert01Icon, InformationCircleIcon, TestTube01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type {
  FieldType,
  Polarity,
  PublicThesis,
  SignalId,
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
import { runTenderAction } from './run-tender-action'

type ModelAnalysisPanelProps = {
  knownSignals: SignalId[]
  maxTheses: number
  publicTheses: PublicThesis[]
  disabled?: boolean
  error?: string | null
  onConfirmThesis: (input: { signalId: SignalId; fieldType: FieldType; polarity: Polarity }) => Promise<void>
}

const previewStyle = (signal?: SignalId) => ({
  '--signal-accent': signal ? signalAccent(signal) : '#64788c',
} as CSSProperties)

export function ModelAnalysisPanel({
  knownSignals,
  maxTheses,
  publicTheses,
  disabled,
  error,
  onConfirmThesis,
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
    <section className={styles.panel} aria-labelledby="analysis-heading">
      <div className={styles.split}>
        <section className={styles.surface}>
          <div className={styles.sectionHeader}>
            <Typography id="analysis-heading" as="h2" variant="bodySmMedium" className={styles.sectionTitle}>
              Публичный тезис
            </Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>Видят все</Typography>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <Typography as="span" variant="caption" tone="muted">{t('tender.analysis.signal')}</Typography>
              <NativeSelect
                aria-label={t('tender.analysis.signalAria')}
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

          <div className={`${styles.preview} mt-3`} style={previewStyle(signalId || undefined)}>
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

          <div className={`${styles.warning} mt-3`}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography variant="bodySm">
              Верный тезис: +1 рейтинг и сертификация. Неверный запускает корпоративную проверку.
            </Typography>
          </div>
        </section>

        <aside className={styles.surface}>
          <div className={styles.sectionHeader}>
            <Typography as="h3" variant="bodySmMedium" className={styles.sectionTitle}>Публичные тезисы</Typography>
            <Typography as="span" variant="caption" className={styles.sectionMeta}>{publicTheses.length}</Typography>
          </div>
          {publicTheses.length === 0 ? (
            <Typography variant="bodySm" tone="muted">В этом тендере тезисов ещё нет.</Typography>
          ) : (
            <div className={styles.journalList}>
              {publicTheses.slice(-4).reverse().map((thesis, index) => (
                <div key={`${thesis.playerId}-${thesis.signalId}-${index}`} className={styles.journalEntry} style={previewStyle(thesis.signalId)}>
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
        </aside>
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
          <HugeiconsIcon icon={TestTube01Icon} strokeWidth={1.7} aria-hidden="true" />
          {t('tender.analysis.submit')}
        </Button>
      </footer>
    </section>
  )
}
