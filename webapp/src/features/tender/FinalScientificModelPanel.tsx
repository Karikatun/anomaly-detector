import { useState } from 'react'

import type { ScientificModel } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

const signals = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'] as const
const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

const fieldTypes = ['inertial', 'electromagnetic', 'phase'] as const
const ftLabels: Record<string, string> = {
  inertial: 'Инерционное', electromagnetic: 'Электромагнитное', phase: 'Фазовое',
}
const polarities = ['positive', 'negative'] as const

type Props = {
  disabled?: boolean
  error?: string | null
  onConfirm: (model: ScientificModel) => void
}

export function FinalScientificModelPanel({ disabled, error, onConfirm }: Props) {
  const [model, setModel] = useState<Record<string, { fieldType?: string; polarity?: string }>>({})

  const toggle = (signal: string, key: 'fieldType' | 'polarity', value: string) => {
    setModel((prev) => {
      const current = prev[signal] ?? {}
      return {
        ...prev,
        [signal]: {
          ...current,
          [key]: current[key] === value ? undefined : value,
        },
      }
    })
  }

  const handleSubmit = () => {
    const signals = Object.fromEntries(
      Object.entries(model)
        .filter(([, cell]) => cell.fieldType || cell.polarity)
        .map(([sig, cell]) => [sig, {
          ...(cell.fieldType ? { fieldType: cell.fieldType } : {}),
          ...(cell.polarity ? { polarity: cell.polarity } : {}),
        }]),
    )

    if (Object.keys(signals).length > 0) {
      onConfirm({ signals } as ScientificModel)
    }
  }

  const claimedCount = Object.values(model).filter((c) => c.fieldType || c.polarity).length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Финальная научная модель</CardTitle>
        <CardDescription>
          Финальный раунд. Укажите свойства каждого сигнала — тип поля и полярность.
          За каждый верный параметр +1 рейтинг, за полностью верную модель +3 бонус.
          Заявлено сигналов: {claimedCount} / 6.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {signals.map((signal) => {
            const cell = model[signal]
            return (
              <Card key={signal} size="sm">
                <CardContent className="grid gap-3 py-4">
                  <Typography variant="bodySm" className="text-center font-bold">
                    {signalNames[signal]}
                  </Typography>

                  {/* Field type */}
                  <div>
                    <Typography variant="control" tone="muted" className="mb-1">
                      Тип поля
                    </Typography>
                    <div className="grid gap-0.5">
                      {fieldTypes.map((ft) => (
                        <button
                          aria-label={`${signalNames[signal]}: тип поля ${ftLabels[ft]}`}
                          key={ft}
                          type="button"
                          disabled={disabled}
                          className={`h-7 rounded px-2 text-xs transition-colors ${
                            cell?.fieldType === ft
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                          onClick={() => toggle(signal, 'fieldType', ft)}
                        >
                          {ftLabels[ft]}
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
                          aria-label={`${signalNames[signal]}: полярность ${pol === 'positive' ? 'Позитив' : 'Негатив'}`}
                          key={pol}
                          type="button"
                          disabled={disabled}
                          className={`h-7 rounded px-2 text-xs transition-colors ${
                            cell?.polarity === pol
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                          onClick={() => toggle(signal, 'polarity', pol)}
                        >
                          {pol === 'positive' ? 'Позитив (+)' : 'Негатив (−)'}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}

        <Button
          type="button"
          size="lg"
          className="mt-6 w-full"
          disabled={disabled || claimedCount === 0}
          onClick={handleSubmit}
        >
          {claimedCount === 0
            ? 'Укажите хотя бы одно свойство'
            : 'Отправить финальную модель'}
        </Button>
      </CardContent>
    </Card>
  )
}
