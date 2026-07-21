import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

const categories = [
  { key: 'reconnaissance' as const, label: 'Разведка', desc: 'Получить образцы сигналов' },
  { key: 'laboratory' as const, label: 'Лаборатория', desc: 'Провести направленный опыт' },
  { key: 'modelAnalysis' as const, label: 'Анализ модели', desc: 'Выдвинуть публичный тезис' },
  { key: 'contracts' as const, label: 'Контракты', desc: 'Зарезервировать и выполнить контракт' },
]

type Allocation = {
  reconnaissance: number
  laboratory: number
  modelAnalysis: number
  contracts: number
}

type PowerAllocationPanelProps = {
  disabled?: boolean
  error?: string | null
  onConfirm: (allocation: Allocation) => void
}

export function PowerAllocationPanel({ disabled, error, onConfirm }: PowerAllocationPanelProps) {
  const [allocation, setAllocation] = useState<Allocation>({
    reconnaissance: 0,
    laboratory: 0,
    modelAnalysis: 0,
    contracts: 0,
  })

  const total = useMemo(
    () => Object.values(allocation).reduce((sum, v) => sum + v, 0),
    [allocation],
  )
  const isValid = total === 4

  const increment = (key: keyof Allocation) => {
    setAllocation((prev) => {
      if (prev[key] >= 2 || total >= 4) return prev
      return { ...prev, [key]: prev[key] + 1 }
    })
  }

  const decrement = (key: keyof Allocation) => {
    setAllocation((prev) => {
      if (prev[key] <= 0) return prev
      return { ...prev, [key]: prev[key] - 1 }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Распределение мощности</CardTitle>
        <CardDescription>
          Распределите 4 единицы мощности. Не более 2 на категорию.{' '}
          Распределено: {total} / 4
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {categories.map(({ key, label, desc }) => (
            <div
              key={key}
              className="flex items-center gap-4 rounded-lg border p-4"
            >
              <div className="grid flex-1 gap-1">
                <Typography variant="bodySm" className="font-medium">
                  {label}
                </Typography>
                <Typography variant="control" tone="muted">
                  {desc}
                </Typography>
                <Typography variant="control" tone="muted">
                  {allocation[key] === 0
                    ? '—'
                    : allocation[key] === 1
                      ? '1 мощность'
                      : '2 мощности'}
                </Typography>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={disabled || allocation[key] <= 0}
                  onClick={() => decrement(key)}
                >
                  −
                </Button>
                <Typography variant="h6" className="w-6 text-center">
                  {allocation[key]}
                </Typography>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0"
                  disabled={disabled || allocation[key] >= 2 || total >= 4}
                  onClick={() => increment(key)}
                >
                  +
                </Button>
              </div>
            </div>
          ))}
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
          disabled={disabled || !isValid}
          onClick={() => {
            if (isValid) {
              onConfirm(allocation)
            }
          }}
        >
          {isValid ? 'Подтвердить распределение' : `Осталось распределить: ${4 - total}`}
        </Button>
      </CardContent>
    </Card>
  )
}
