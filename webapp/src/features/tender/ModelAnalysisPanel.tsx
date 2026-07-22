import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'

const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

const fieldTypes = ['inertial', 'electromagnetic', 'phase'] as const
const polarities = ['positive', 'negative'] as const

const fieldTypeLabels: Record<string, string> = {
  inertial: 'Инерционное',
  electromagnetic: 'Электромагнитное',
  phase: 'Фазовое',
}

type ModelAnalysisPanelProps = {
  knownSignals: string[]
  maxTheses: number
  disabled?: boolean
  error?: string | null
  onConfirmThesis: (input: { signalId: string; fieldType: string; polarity: string }) => void
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

  const isValid = signalId && fieldType && polarity

  const handleSubmit = () => {
    if (isValid) {
      onConfirmThesis({ signalId, fieldType, polarity })
      setFieldType('')
      setPolarity('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Анализ модели</CardTitle>
        <CardDescription>
          Выдвиньте публичный тезис о свойствах сигнала.{' '}
          {maxTheses > 1 && 'Доступно расширенное подтверждение (2 мощности).'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div>
            <Typography variant="control" tone="muted" className="mb-1">Сигнал</Typography>
            <NativeSelect aria-label="Сигнал для тезиса" value={signalId} onChange={(e) => setSignalId(e.target.value)}>
              <option value="">Выберите сигнал…</option>
              {knownSignals.map((s) => (
                <option key={s} value={s}>{signalNames[s] ?? s}</option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <Typography variant="control" tone="muted" className="mb-1">Тип поля</Typography>
            <NativeSelect aria-label="Тип поля для тезиса" value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              <option value="">Выберите тип…</option>
              {fieldTypes.map((ft) => (
                <option key={ft} value={ft}>{fieldTypeLabels[ft]}</option>
              ))}
            </NativeSelect>
          </div>

          <div>
            <Typography variant="control" tone="muted" className="mb-1">Полярность</Typography>
            <NativeSelect aria-label="Полярность для тезиса" value={polarity} onChange={(e) => setPolarity(e.target.value)}>
              <option value="">Выберите полярность…</option>
              {polarities.map((p) => (
                <option key={p} value={p}>{p === 'positive' ? 'Положительная' : 'Отрицательная'}</option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}

        <Button type="button" size="lg" className="mt-6 w-full" disabled={disabled || !isValid} onClick={handleSubmit}>
          Выдвинуть тезис
        </Button>
      </CardContent>
    </Card>
  )
}
