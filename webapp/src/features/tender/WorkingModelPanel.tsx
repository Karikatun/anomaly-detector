import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkingModel } from '@anomaly-detector/contracts'

import { Card, CardContent } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

const signals = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'] as const
const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

const fieldTypes = ['inertial', 'electromagnetic', 'phase'] as const
const ftLabels: Record<string, string> = {
  inertial: 'Инерц.', electromagnetic: 'Эл-магн.', phase: 'Фазов.',
}
const polarities = ['positive', 'negative'] as const

type MarkerState = 'unset' | 'possible' | 'excluded'

const markerColors: Record<MarkerState, string> = {
  unset: 'bg-muted text-muted-foreground',
  possible: 'bg-green-500/20 text-green-400 ring-1 ring-green-500/50',
  excluded: 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50 line-through',
}

type SignalCell = NonNullable<WorkingModel['signals'][keyof WorkingModel['signals']]>

type WorkingModelPanelProps = {
  model: WorkingModel
  knownSignals: string[]
  disabled?: boolean
  onSave: (model: WorkingModel) => void
}

export function WorkingModelPanel({ model, knownSignals, disabled, onSave }: WorkingModelPanelProps) {
  const [draft, setDraft] = useState<WorkingModel>(model)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      onSave(draftRef.current)
    }, 800)
  }, [onSave])

  useEffect(() => {
    return () => clearTimeout(saveTimer.current)
  }, [])

  // Sync from parent if model changes externally
  useEffect(() => {
    setDraft(model)
  }, [model])

  const updateSignal = (signal: string, cell: SignalCell) => {
    setDraft((prev) => ({
      ...prev,
      signals: {
        ...prev.signals,
        [signal]: cell,
      },
    }))
    scheduleSave()
  }

  const getCell = (signal: string): NonNullable<SignalCell> => {
    const all = (draft.signals ?? {}) as Record<string, SignalCell | undefined>
    return all[signal] ?? {}
  }

  const toggleFieldType = (signal: string, ft: string, current: MarkerState, isExcluded: boolean) => {
    const cell = getCell(signal)
    const possible: string[] = cell.possibleFieldTypes ?? []
    const excluded: string[] = cell.excludedFieldTypes ?? []
    let nextPossible = possible.filter((f) => f !== ft)
    let nextExcluded = excluded.filter((f) => f !== ft)
    const isHypothesis = cell.hypothesis?.fieldType === ft

    if ((current === 'unset' && !isExcluded) || (isExcluded && !nextExcluded.includes(ft))) {
      // Move from excluded/unset to possible
      nextPossible = [...nextPossible, ft]
    } else if (current === 'possible' || isExcluded) {
      // Move to excluded
      nextExcluded = [...nextExcluded, ft]
    }

    updateSignal(signal, {
      ...cell,
      possibleFieldTypes: nextPossible.length > 0 ? (nextPossible as typeof cell.possibleFieldTypes) : undefined,
      excludedFieldTypes: nextExcluded.length > 0 ? (nextExcluded as typeof cell.excludedFieldTypes) : undefined,
      ...(isHypothesis ? { hypothesis: { ...cell.hypothesis!, fieldType: undefined } } : {}),
    })
  }

  const togglePolarity = (signal: string, pol: string, current: MarkerState, isExcluded: boolean) => {
    const cell = getCell(signal)
    const possible: string[] = cell.possiblePolarities ?? []
    const excluded: string[] = cell.excludedPolarities ?? []
    let nextPossible = possible.filter((p) => p !== pol)
    let nextExcluded = excluded.filter((p) => p !== pol)
    const isHypothesis = cell.hypothesis?.polarity === pol

    if ((current === 'unset' && !isExcluded) || (isExcluded && !nextExcluded.includes(pol))) {
      nextPossible = [...nextPossible, pol]
    } else if (current === 'possible' || isExcluded) {
      nextExcluded = [...nextExcluded, pol]
    }

    updateSignal(signal, {
      ...cell,
      possiblePolarities: nextPossible.length > 0 ? (nextPossible as typeof cell.possiblePolarities) : undefined,
      excludedPolarities: nextExcluded.length > 0 ? (nextExcluded as typeof cell.excludedPolarities) : undefined,
      ...(isHypothesis ? { hypothesis: { ...cell.hypothesis!, polarity: undefined } } : {}),
    })
  }

  const setHypothesis = (signal: string, key: 'fieldType' | 'polarity', value: string) => {
    const cell = getCell(signal)
    const hyp = cell.hypothesis
    const current = hyp?.[key]
    updateSignal(signal, {
      ...cell,
      hypothesis: {
        ...hyp,
        [key]: current === value ? undefined : value,
      },
    })
  }

  const setNote = (signal: string, note: string) => {
    const cell = getCell(signal)
    updateSignal(signal, { ...cell, note: note.slice(0, 1000) })
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {signals.map((signal) => {
        const isKnown = knownSignals.includes(signal)
        const cell = draft.signals?.[signal]
        const hyp = cell?.hypothesis

        return (
          <Card key={signal} size="sm" className={!isKnown ? 'opacity-40' : ''}>
            <CardContent className="grid gap-3 py-4">
              <Typography variant="bodySm" className="text-center font-bold">
                {signalNames[signal]}
              </Typography>

              {/* Field types */}
              <div>
                <Typography variant="control" tone="muted" className="mb-1">Тип поля</Typography>
                <div className="flex gap-1">
                  {fieldTypes.map((ft) => {
                    const marker: MarkerState = (cell?.excludedFieldTypes?.includes(ft) ?? false)
                      ? 'excluded'
                      : (cell?.possibleFieldTypes?.includes(ft) ?? false)
                        ? 'possible'
                        : 'unset'
                    const isExcluded = marker === 'excluded'
                    const isHyp = hyp?.fieldType === ft
                    return (
                      <button
                        key={ft}
                        type="button"
                        disabled={disabled}
                        className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                          isHyp
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary'
                            : markerColors[marker]
                        }`}
                        onClick={() => { if (!isHyp) toggleFieldType(signal, ft, marker, isExcluded) }}
                      >
                        {ftLabels[ft]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Polarities */}
              <div>
                <Typography variant="control" tone="muted" className="mb-1">Полярность</Typography>
                <div className="flex gap-1">
                  {polarities.map((pol) => {
                    const marker: MarkerState = (cell?.excludedPolarities?.includes(pol) ?? false)
                      ? 'excluded'
                      : (cell?.possiblePolarities?.includes(pol) ?? false)
                        ? 'possible'
                        : 'unset'
                    const isExcluded = marker === 'excluded'
                    const isHyp = hyp?.polarity === pol
                    return (
                      <button
                        key={pol}
                        type="button"
                        disabled={disabled}
                        className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                          isHyp
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary'
                            : markerColors[marker]
                        }`}
                        onClick={() => { if (!isHyp) togglePolarity(signal, pol, marker, isExcluded) }}
                      >
                        {pol === 'positive' ? '+' : '−'}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Hypothesis */}
              <div>
                <Typography variant="control" tone="muted" className="mb-1">Гипотеза</Typography>
                <div className="grid grid-cols-2 gap-1">
                  <div className="grid gap-0.5">
                    {fieldTypes.map((ft) => (
                      <button
                        key={ft}
                        type="button"
                        disabled={disabled}
                        className={`h-6 rounded px-1 text-xs transition-colors ${
                          hyp?.fieldType === ft
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => setHypothesis(signal, 'fieldType', ft)}
                      >
                        {ftLabels[ft]}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-0.5">
                    {polarities.map((pol) => (
                      <button
                        key={pol}
                        type="button"
                        disabled={disabled}
                        className={`h-6 rounded px-1 text-xs transition-colors ${
                          hyp?.polarity === pol
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => setHypothesis(signal, 'polarity', pol)}
                      >
                        {pol === 'positive' ? '+' : '−'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Note */}
              <input
                type="text"
                placeholder="Заметка..."
                className="w-full rounded border bg-transparent px-2 py-1 text-xs text-muted-foreground"
                value={cell?.note ?? ''}
                disabled={disabled}
                onChange={(e) => setNote(signal, e.target.value)}
              />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
