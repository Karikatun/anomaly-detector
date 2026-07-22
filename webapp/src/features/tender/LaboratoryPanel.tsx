import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

const protocolLabels: Record<string, string> = {
  impulse: 'Импульс (быстрый, публичный результат)',
  continuous: 'Непрерывный (медленный, приватное измерение)',
}

type LaboratoryPanelProps = {
  mySamples: string[]
  powerAllocation: number
  disabled?: boolean
  error?: string | null
  onConfirm: (input: { sourceSignal: string; receiverSignal: string; protocol: 'impulse' | 'continuous' }) => void
}

export function LaboratoryPanel({ mySamples, powerAllocation, disabled, error, onConfirm }: LaboratoryPanelProps) {
  const [source, setSource] = useState<string>('')
  const [receiver, setReceiver] = useState<string>('')

  const protocol: 'impulse' | 'continuous' = powerAllocation >= 2 ? 'continuous' : 'impulse'
  const isValid = source && receiver && source !== receiver

  const handleTest = () => {
    if (isValid) {
      onConfirm({ sourceSignal: source, receiverSignal: receiver, protocol })
      setSource('')
      setReceiver('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Лаборатория</CardTitle>
        <CardDescription>
          Направленный опыт: сигнал-источник → сигнал-приёмник. Протокол: {protocolLabels[protocol]}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Source */}
        <Typography variant="control" tone="muted" className="mb-2">Источник</Typography>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {mySamples.map((signal) => (
            <Button
              aria-label={`Источник: ${signalNames[signal] ?? signal}`}
              key={`src-${signal}`}
              type="button"
              variant={source === signal ? 'default' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => { setSource(source === signal ? '' : signal); if (receiver === signal) setReceiver('') }}
            >
              {signalNames[signal] ?? signal}
            </Button>
          ))}
        </div>

        {/* Receiver */}
        <Typography variant="control" tone="muted" className="mb-2">Приёмник</Typography>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {mySamples.filter((s) => s !== source).map((signal) => (
            <Button
              aria-label={`Приёмник: ${signalNames[signal] ?? signal}`}
              key={`rec-${signal}`}
              type="button"
              variant={receiver === signal ? 'default' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => setReceiver(receiver === signal ? '' : signal)}
            >
              {signalNames[signal] ?? signal}
            </Button>
          ))}
        </div>

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mb-4">
            {error}
          </Typography>
        )}

        <Button type="button" size="lg" className="w-full" disabled={disabled || !isValid} onClick={handleTest}>
          Провести опыт
        </Button>
      </CardContent>
    </Card>
  )
}
