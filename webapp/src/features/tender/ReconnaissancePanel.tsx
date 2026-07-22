import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

const signalNames: Record<string, string> = {
  aster: 'Aster',
  boreal: 'Boreal',
  cinder: 'Cinder',
  delta: 'Delta',
  eclipse: 'Eclipse',
  ferro: 'Ferro',
}

type ReconnaissancePanelProps = {
  knownSignals: string[]
  mySamples: string[]
  maxSignals: number
  disabled?: boolean
  error?: string | null
  onConfirm: (signals: string[]) => void
}

export function ReconnaissancePanel({
  knownSignals,
  mySamples,
  maxSignals,
  disabled,
  error,
  onConfirm,
}: ReconnaissancePanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const available = knownSignals.filter((s) => !mySamples.includes(s))

  const toggle = (signal: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(signal)) {
        next.delete(signal)
      } else if (next.size < maxSignals) {
        next.add(signal)
      }
      return next
    })
  }

  const handleConfirm = () => {
    const signals = [...selected]
    if (signals.length === maxSignals) {
      onConfirm(signals)
      setSelected(new Set())
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Разведка</CardTitle>
        <CardDescription>
          {maxSignals === 1
            ? 'Выберите один сигнал для получения образца.'
            : 'Выберите до двух сигналов для получения образцов.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {available.length === 0 && (
          <Typography tone="muted">Нет доступных сигналов для разведки.</Typography>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {available.map((signal) => {
            const isSel = selected.has(signal)
            return (
              <Button
                aria-label={`Сигнал для разведки: ${signalNames[signal] ?? signal}`}
                key={signal}
                type="button"
                variant={isSel ? 'default' : 'outline'}
                size="lg"
                className="h-auto flex-col gap-1 py-4"
                disabled={disabled || (!isSel && selected.size >= maxSignals)}
                onClick={() => toggle(signal)}
              >
                <Typography variant="h6">{signalNames[signal] ?? signal}</Typography>
                <Typography variant="control" tone="muted">
                  {signal}
                </Typography>
              </Button>
            )
          })}
        </div>

        {mySamples.length > 0 && (
          <Typography variant="control" tone="muted" className="mt-4">
            Уже есть образцы: {mySamples.map((s) => signalNames[s] ?? s).join(', ')}
          </Typography>
        )}

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}

        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || selected.size !== maxSignals}
          onClick={handleConfirm}
        >
          {selected.size === 0
            ? `Выберите ${maxSignals === 1 ? 'сигнал' : `${maxSignals} сигнала`}`
            : selected.size < maxSignals
              ? `Выбрано ${selected.size} из ${maxSignals}`
              : 'Исследовать'}
        </Button>
      </CardContent>
    </Card>
  )
}
