import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

const slotLabels = ['Emergency', 'Priority', 'Standard', 'Off-peak', 'Night', 'Remote'] as const
const slotCosts = [-2, -1, 0, 0, 0, 1] as const

type AccessSlotPanelProps = {
  disabled?: boolean
  error?: string | null
  onConfirm: (slot: number) => void
}

export function AccessSlotPanel({ disabled, error, onConfirm }: AccessSlotPanelProps) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Выбор слота доступа</CardTitle>
        <CardDescription>
          Выберите один из шести слотов. Ранний доступ даёт приоритет в действиях, поздний — ресурсы.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => {
            const slot = i + 1
            const isSelected = selected === slot
            const cost = slotCosts[i]

            return (
              <Button
                key={slot}
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                size="lg"
                className="flex h-auto flex-col gap-1 py-4"
                disabled={disabled}
                onClick={() => setSelected(slot)}
              >
                <Typography variant="h6">{String(slot).padStart(2, '0')}</Typography>
                <Typography variant="control" tone="muted">
                  {slotLabels[i]}
                </Typography>
                {cost !== 0 && (
                  <Typography variant="control" tone={cost > 0 ? 'default' : 'destructive'}>
                    {cost > 0 ? `+${cost}` : cost} бюджет
                  </Typography>
                )}
              </Button>
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
          disabled={disabled || selected === null}
          onClick={() => {
            if (selected !== null) {
              onConfirm(selected)
              setSelected(null)
            }
          }}
        >
          Подтвердить выбор
        </Button>
      </CardContent>
    </Card>
  )
}
