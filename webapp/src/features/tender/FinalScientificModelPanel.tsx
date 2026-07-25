import { useState } from 'react'

import type {
  FieldType,
  Polarity,
  ScientificModel,
  SignalId,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import {
  fieldTypeLabelKeys,
  fieldTypes,
  polarities,
  polarityLabelKeys,
  signalIds,
  signalLabelKeys,
} from './catalog'
import { TenderActionPanel } from './components/TenderActionPanel'
import { runTenderAction } from './run-tender-action'

type Props = {
  disabled?: boolean
  error?: string | null
  onConfirm: (model: ScientificModel) => Promise<void>
}

export function FinalScientificModelPanel({ disabled, error, onConfirm }: Props) {
  const { t } = useI18n()
  const [model, setModel] = useState<ScientificModel['signals']>({})

  const toggleFieldType = (signal: SignalId, value: FieldType) => {
    setModel((prev) => {
      const current = prev[signal] ?? {}
      const fieldType = current.fieldType === value ? undefined : value
      if (!fieldType && !current.polarity) {
        const next = { ...prev }
        delete next[signal]
        return next
      }
      return {
        ...prev,
        [signal]: {
          ...current,
          fieldType,
        },
      }
    })
  }

  const togglePolarity = (signal: SignalId, value: Polarity) => {
    setModel((prev) => {
      const current = prev[signal] ?? {}
      const polarity = current.polarity === value ? undefined : value
      if (!current.fieldType && !polarity) {
        const next = { ...prev }
        delete next[signal]
        return next
      }
      return {
        ...prev,
        [signal]: {
          ...current,
          polarity,
        },
      }
    })
  }

  const handleSubmit = async () => {
    if (Object.keys(model).length > 0) {
      await runTenderAction(() => onConfirm({ signals: model }))
    }
  }

  const claimedCount = Object.values(model).filter((c) => c.fieldType || c.polarity).length

  return (
    <TenderActionPanel
      title="Финальная научная модель"
      description={(
        <>
          Финальный раунд. Укажите свойства каждого сигнала — тип поля и полярность.
          За каждый верный параметр +1 рейтинг, за полностью верную модель +3 бонус.
          Заявлено сигналов: {claimedCount} / 6.
        </>
      )}
      error={error}
      footer={(
        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || claimedCount === 0}
          onClick={() => void handleSubmit()}
        >
          {claimedCount === 0
            ? 'Укажите хотя бы одно свойство'
            : 'Отправить финальную модель'}
        </Button>
      )}
    >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {signalIds.map((signal) => {
            const cell = model[signal]
            const signalName = t(signalLabelKeys[signal])
            return (
              <Card key={signal} size="sm">
                <CardContent className="grid gap-3 py-4">
                  <Typography variant="bodySmMedium" align="center">
                    {signalName}
                  </Typography>

                  {/* Field type */}
                  <div>
                    <Typography variant="control" tone="muted" className="mb-1">
                      Тип поля
                    </Typography>
                    <div className="grid gap-0.5">
                      {fieldTypes.map((ft) => (
                        <button
                          aria-label={`${signalName}: тип поля ${t(fieldTypeLabelKeys[ft])}`}
                          key={ft}
                          type="button"
                          disabled={disabled}
                          className={`h-7 rounded px-2 transition-colors ${
                            cell?.fieldType === ft
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                          onClick={() => toggleFieldType(signal, ft)}
                        >
                          <Typography variant="controlXs">{t(fieldTypeLabelKeys[ft])}</Typography>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Polarity */}
                  <div>
                    <Typography variant="control" tone="muted" className="mb-1">
                      Полярность
                    </Typography>
                    <div className="grid grid-cols-2 gap-1">
                      {polarities.map((pol) => (
                        <button
                          aria-label={`${signalName}: полярность ${t(polarityLabelKeys[pol])}`}
                          key={pol}
                          type="button"
                          disabled={disabled}
                          className={`h-7 rounded px-2 transition-colors ${
                            cell?.polarity === pol
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                          onClick={() => togglePolarity(signal, pol)}
                        >
                          <Typography variant="controlXs">
                            {t(polarityLabelKeys[pol])} {pol === 'positive' ? '(+)' : '(−)'}
                          </Typography>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
    </TenderActionPanel>
  )
}
