import { useState } from 'react'

import type { LaboratoryProtocol, SignalId } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { signalLabelKeys } from './catalog'
import { TenderActionPanel } from './components/TenderActionPanel'
import { runTenderAction } from './run-tender-action'

type LaboratoryPanelProps = {
  mySamples: SignalId[]
  powerAllocation: number
  disabled?: boolean
  error?: string | null
  onConfirm: (input: { sourceSignal: SignalId; receiverSignal: SignalId; protocol: LaboratoryProtocol }) => Promise<void>
}

export function LaboratoryPanel({ mySamples, powerAllocation, disabled, error, onConfirm }: LaboratoryPanelProps) {
  const [source, setSource] = useState<SignalId | null>(null)
  const [receiver, setReceiver] = useState<SignalId | null>(null)

  const protocol: LaboratoryProtocol = powerAllocation >= 2 ? 'continuous' : 'impulse'
  const isValid = source && receiver && source !== receiver
  const { t } = useI18n()

  const handleTest = async () => {
    if (isValid) {
      const succeeded = await runTenderAction(
        () => onConfirm({ sourceSignal: source, receiverSignal: receiver, protocol }),
      )
      if (succeeded) {
        setSource(null)
        setReceiver(null)
      }
    }
  }

  return (
    <TenderActionPanel
      title={t('tender.lab.title')}
      description={t('tender.lab.description', { protocol: t(`tender.lab.protocol.${protocol}`) })}
      error={error}
      footer={(
        <Button type="button" size="lg" className="mt-6 w-full" disabled={disabled || !isValid} onClick={() => void handleTest()}>
          {t('tender.lab.confirm')}
        </Button>
      )}
    >
        {/* Source */}
        <Typography variant="control" tone="muted" className="mb-2">{t('tender.lab.source')}</Typography>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {mySamples.map((signal) => (
            <Button
              aria-label={t('tender.lab.sourceAria', { signal: t(signalLabelKeys[signal]) })}
              key={`src-${signal}`}
              type="button"
              variant={source === signal ? 'default' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => { setSource(source === signal ? null : signal); if (receiver === signal) setReceiver(null) }}
            >
              {t(signalLabelKeys[signal])}
            </Button>
          ))}
        </div>

        {/* Receiver */}
        <Typography variant="control" tone="muted" className="mb-2">{t('tender.lab.receiver')}</Typography>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {mySamples.filter((s) => s !== source).map((signal) => (
            <Button
              aria-label={t('tender.lab.receiverAria', { signal: t(signalLabelKeys[signal]) })}
              key={`rec-${signal}`}
              type="button"
              variant={receiver === signal ? 'default' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => setReceiver(receiver === signal ? null : signal)}
            >
              {t(signalLabelKeys[signal])}
            </Button>
          ))}
        </div>

    </TenderActionPanel>
  )
}
