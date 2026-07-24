import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

const fieldTypes = ['inertial', 'electromagnetic', 'phase'] as const
const polarities = ['positive', 'negative'] as const

type ModelAnalysisPanelProps = {
  knownSignals: string[]
  maxTheses: number
  disabled?: boolean
  error?: string | null
  onConfirmThesis: (input: { signalId: string; fieldType: string; polarity: string }) => Promise<void>
}

export function ModelAnalysisPanel({
  knownSignals,
  maxTheses,
  disabled,
  error,
  onConfirmThesis,
}: ModelAnalysisPanelProps) {
  const [signalId, setSignalId] = useState('')
  const [fieldType, setFieldType] = useState('')
  const [polarity, setPolarity] = useState('')
  const { t } = useI18n()

  const isValid = signalId && fieldType && polarity

  const handleSubmit = async () => {
    if (isValid) {
      try {
        await onConfirmThesis({ signalId, fieldType, polarity })
        setFieldType('')
        setPolarity('')
      } catch {
        // The parent owns the visible command error; keep the thesis for retry.
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.analysis.title')}</CardTitle>
        <CardDescription>
          {t('tender.analysis.description')} {maxTheses > 1 && t('tender.analysis.extended')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div>
            <Typography variant="control" tone="muted" className="mb-1">{t('tender.analysis.signal')}</Typography>
            <NativeSelect aria-label={t('tender.analysis.signalAria')} value={signalId} onChange={(e) => setSignalId(e.target.value)}>
              <option value="">{t('tender.analysis.signalPlaceholder')}</option>
              {knownSignals.map((s) => (
                <option key={s} value={s}>{signalNames[s] ?? s}</option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <Typography variant="control" tone="muted" className="mb-1">{t('tender.analysis.fieldType')}</Typography>
            <NativeSelect aria-label={t('tender.analysis.fieldTypeAria')} value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              <option value="">{t('tender.analysis.fieldTypePlaceholder')}</option>
              {fieldTypes.map((ft) => (
                <option key={ft} value={ft}>{t(`tender.field.${ft}`)}</option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <Typography variant="control" tone="muted" className="mb-1">{t('tender.analysis.polarity')}</Typography>
            <NativeSelect aria-label={t('tender.analysis.polarityAria')} value={polarity} onChange={(e) => setPolarity(e.target.value)}>
              <option value="">{t('tender.analysis.polarityPlaceholder')}</option>
              {polarities.map((p) => (
                <option key={p} value={p}>{t(`tender.polarity.${p}`)}</option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}

        <Button type="button" size="lg" className="mt-6 w-full" disabled={disabled || !isValid} onClick={() => void handleSubmit()}>
          {t('tender.analysis.submit')}
        </Button>
      </CardContent>
    </Card>
  )
}
