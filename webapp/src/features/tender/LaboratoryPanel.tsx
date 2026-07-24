import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

type LaboratoryPanelProps = {
  mySamples: string[]
  powerAllocation: number
  disabled?: boolean
  error?: string | null
  onConfirm: (input: { sourceSignal: string; receiverSignal: string; protocol: 'impulse' | 'continuous' }) => Promise<void>
}

export function LaboratoryPanel({ mySamples, powerAllocation, disabled, error, onConfirm }: LaboratoryPanelProps) {
  const [source, setSource] = useState<string>('')
  const [receiver, setReceiver] = useState<string>('')

  const protocol: 'impulse' | 'continuous' = powerAllocation >= 2 ? 'continuous' : 'impulse'
  const isValid = source && receiver && source !== receiver
  const { t } = useI18n()

  const handleTest = async () => {
    if (isValid) {
      try {
        await onConfirm({ sourceSignal: source, receiverSignal: receiver, protocol })
        setSource('')
        setReceiver('')
      } catch {
        // The parent owns the visible command error; keep the test for retry.
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.lab.title')}</CardTitle>
        <CardDescription>
          {t('tender.lab.description', { protocol: t(`tender.lab.protocol.${protocol}`) })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Source */}
        <Typography variant="control" tone="muted" className="mb-2">{t('tender.lab.source')}</Typography>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {mySamples.map((signal) => (
            <Button
              aria-label={t('tender.lab.sourceAria', { signal: signalNames[signal] ?? signal })}
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
        <Typography variant="control" tone="muted" className="mb-2">{t('tender.lab.receiver')}</Typography>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {mySamples.filter((s) => s !== source).map((signal) => (
            <Button
              aria-label={t('tender.lab.receiverAria', { signal: signalNames[signal] ?? signal })}
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

        <Button type="button" size="lg" className="w-full" disabled={disabled || !isValid} onClick={() => void handleTest()}>
          {t('tender.lab.confirm')}
        </Button>
      </CardContent>
    </Card>
  )
}
