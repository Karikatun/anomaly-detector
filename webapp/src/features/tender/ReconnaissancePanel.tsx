import { useState } from 'react'

import type { SignalId } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { isSignalId, signalLabelKeys } from './catalog'

type ReconnaissancePanelProps = {
  mySamples: SignalId[]
  knownSignals: SignalId[]
  maxSignals: number
  disabled?: boolean
  error?: string | null
  onConfirm: (targets: Array<SignalId | 'unknown-sector'>) => Promise<void>
}

export function availableReconnaissanceTargets({ knownSignals, mySamples }: Pick<ReconnaissancePanelProps, 'knownSignals' | 'mySamples'>) {
  return ['unknown-sector-1', 'unknown-sector-2', ...knownSignals.filter((signal) => !mySamples.includes(signal))]
}

export function ReconnaissancePanel({
  mySamples,
  knownSignals,
  maxSignals,
  disabled,
  error,
  onConfirm,
}: ReconnaissancePanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { t } = useI18n()
  const signalName = (signal: string) => isSignalId(signal) ? t(signalLabelKeys[signal]) : signal

  const available = availableReconnaissanceTargets({ knownSignals, mySamples })

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

  const handleConfirm = async () => {
    const targets = [...selected].map((target): SignalId | 'unknown-sector' => (
      target.startsWith('unknown-sector-') ? 'unknown-sector' : target as SignalId
    ))
    if (targets.length === maxSignals) {
      try {
        await onConfirm(targets)
        setSelected(new Set())
      } catch {
        // The parent owns the visible command error; keep the targets for retry.
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tender.recon.title')}</CardTitle>
        <CardDescription>
          {maxSignals === 1
            ? t('tender.recon.description.one')
            : t('tender.recon.description.many')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {available.length === 0 && (
          <Typography tone="muted">{t('tender.recon.empty')}</Typography>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {available.map((signal) => {
            const isSel = selected.has(signal)
            return (
              <Button
                aria-label={t('tender.recon.aria', { signal: signalName(signal) })}
                key={signal}
                type="button"
                variant={isSel ? 'default' : 'outline'}
                size="lg"
                className="h-auto flex-col gap-1 py-4"
                disabled={disabled || (!isSel && selected.size >= maxSignals)}
                onClick={() => toggle(signal)}
              >
                <Typography variant="h6">{signal.startsWith('unknown-sector-') ? 'Неизвестный сектор' : signalName(signal)}</Typography>
                <Typography variant="control" tone="muted">
                  {signal}
                </Typography>
              </Button>
            )
          })}
        </div>

        {mySamples.length > 0 && (
          <Typography variant="control" tone="muted" className="mt-4">
            {t('tender.recon.samples', { signals: mySamples.map(signalName).join(', ') })}
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
          onClick={() => void handleConfirm()}
        >
          {selected.size === 0
            ? maxSignals === 1 ? t('tender.recon.choose.one') : t('tender.recon.choose.many', { count: maxSignals })
            : selected.size < maxSignals
              ? t('tender.recon.selected', { selected: selected.size, total: maxSignals })
              : t('tender.recon.confirm')}
        </Button>
      </CardContent>
    </Card>
  )
}
