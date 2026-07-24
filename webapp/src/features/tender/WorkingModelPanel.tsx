import { useEffect, useState } from 'react'

import type { WorkingModel } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import {
  WorkingModelDraftController,
  type WorkingModelSaveStatus,
} from './working-model-draft'

const signals = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'] as const
const signalNames: Record<string, string> = {
  aster: 'Aster', boreal: 'Boreal', cinder: 'Cinder',
  delta: 'Delta', eclipse: 'Eclipse', ferro: 'Ferro',
}

const fieldTypes = ['inertial', 'electromagnetic', 'phase'] as const
const polarities = ['positive', 'negative'] as const
const fieldTypeLabels: Record<(typeof fieldTypes)[number], string> = {
  inertial: 'Инерционное',
  electromagnetic: 'Электромагнитное',
  phase: 'Фазовое',
}
const polarityLabels: Record<(typeof polarities)[number], string> = {
  positive: 'Позитивная',
  negative: 'Негативная',
}

type MarkerState = 'unset' | 'possible' | 'excluded'

const markerColors: Record<MarkerState, string> = {
  unset: 'bg-muted text-muted-foreground',
  possible: 'bg-green-500/20 text-green-400 ring-1 ring-green-500/50',
  excluded: 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50 line-through',
}
const markerLabels: Record<MarkerState, string> = {
  unset: 'не задано',
  possible: 'возможно',
  excluded: 'исключено',
}

type SignalCell = NonNullable<WorkingModel['signals'][keyof WorkingModel['signals']]>

type WorkingModelPanelProps = {
  model: WorkingModel
  knownSignals: string[]
  disabled?: boolean
  onSave: (model: WorkingModel) => Promise<void>
}

export function WorkingModelPanel({ model, knownSignals, disabled, onSave }: WorkingModelPanelProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<WorkingModel>(model)
  const [saveStatus, setSaveStatus] = useState<WorkingModelSaveStatus>({ state: 'idle' })
  const [draftController] = useState(() => new WorkingModelDraftController({
    cancel: clearTimeout,
    initialModel: model,
    onDraft: setDraft,
    onStatus: setSaveStatus,
    save: onSave,
    schedule: setTimeout,
  }))

  useEffect(() => {
    draftController.setSave(onSave)
  }, [draftController, onSave])

  useEffect(() => {
    draftController.receiveServerModel(model)
  }, [draftController, model])

  useEffect(
    () => () => {
      void draftController.dispose()
    },
    [draftController],
  )

  const updateSignal = (signal: string, cell: SignalCell) => {
    draftController.update({
      ...draft,
      signals: {
        ...draft.signals,
        [signal]: cell,
      },
    })
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
    <div className="grid gap-3">
      {saveStatus.state === 'saving' && (
        <Typography role="status" variant="control" tone="muted">
          Сохраняем рабочую модель…
        </Typography>
      )}
      {saveStatus.state === 'error' && (
        <div className="flex flex-wrap items-center gap-3">
          <Typography role="alert" variant="bodySm" tone="destructive">
            {saveStatus.message}
          </Typography>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void draftController.retry()}
          >
            Повторить сохранение
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((signal) => {
        const isKnown = knownSignals.includes(signal)
        const cell = draft.signals?.[signal]
        const hyp = cell?.hypothesis

        return (
          <Card key={signal} size="sm" className={!isKnown ? 'opacity-40' : ''}>
            <CardContent className="grid gap-3 py-4">
              <Typography variant="bodySmMedium" className="text-center">
                {signalNames[signal]}
              </Typography>

              {/* Field types */}
              <div role="group" aria-label={`${signalNames[signal]}: возможные типы поля`}>
                <Typography variant="control" tone="muted" className="mb-1">{t('tender.model.fieldType')}</Typography>
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
                        aria-label={`${signalNames[signal]}: тип поля ${fieldTypeLabels[ft]}, ${isHyp ? 'выбрано как гипотеза' : markerLabels[marker]}`}
                        aria-pressed={isHyp || marker !== 'unset'}
                        data-marker-state={isHyp ? 'hypothesis' : marker}
                        key={ft}
                        type="button"
                        disabled={disabled}
                        className={`flex-1 rounded px-2 py-1 transition-colors ${
                          isHyp
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary'
                            : markerColors[marker]
                        }`}
                        onClick={() => { if (!isHyp) toggleFieldType(signal, ft, marker, isExcluded) }}
                      >
                        <Typography variant="control">{t(`tender.fieldShort.${ft}`)}</Typography>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Polarities */}
              <div role="group" aria-label={`${signalNames[signal]}: возможные полярности`}>
                <Typography variant="control" tone="muted" className="mb-1">{t('tender.model.polarity')}</Typography>
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
                        aria-label={`${signalNames[signal]}: полярность ${polarityLabels[pol]}, ${isHyp ? 'выбрано как гипотеза' : markerLabels[marker]}`}
                        aria-pressed={isHyp || marker !== 'unset'}
                        data-marker-state={isHyp ? 'hypothesis' : marker}
                        key={pol}
                        type="button"
                        disabled={disabled}
                        className={`flex-1 rounded px-2 py-1 transition-colors ${
                          isHyp
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary'
                            : markerColors[marker]
                        }`}
                        onClick={() => { if (!isHyp) togglePolarity(signal, pol, marker, isExcluded) }}
                      >
                        <Typography variant="control">{pol === 'positive' ? '+' : '−'}</Typography>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Hypothesis */}
              <div role="group" aria-label={`${signalNames[signal]}: гипотеза`}>
                <Typography variant="control" tone="muted" className="mb-1">{t('tender.model.hypothesis')}</Typography>
                <div className="grid grid-cols-2 gap-1">
                  <div className="grid gap-0.5">
                    {fieldTypes.map((ft) => (
                      <button
                        aria-label={`${signalNames[signal]}: гипотеза, тип поля ${fieldTypeLabels[ft]}`}
                        aria-pressed={hyp?.fieldType === ft}
                        key={ft}
                        type="button"
                        disabled={disabled}
                        className={`h-6 rounded px-1 transition-colors ${
                          hyp?.fieldType === ft
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => setHypothesis(signal, 'fieldType', ft)}
                      >
                        <Typography variant="control">{t(`tender.fieldShort.${ft}`)}</Typography>
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-0.5">
                    {polarities.map((pol) => (
                      <button
                        aria-label={`${signalNames[signal]}: гипотеза, полярность ${polarityLabels[pol]}`}
                        aria-pressed={hyp?.polarity === pol}
                        key={pol}
                        type="button"
                        disabled={disabled}
                        className={`h-6 rounded px-1 transition-colors ${
                          hyp?.polarity === pol
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => setHypothesis(signal, 'polarity', pol)}
                      >
                        <Typography variant="control">{pol === 'positive' ? '+' : '−'}</Typography>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Note */}
              <input
                aria-label={`${signalNames[signal]}: заметка`}
                type="text"
                placeholder={t('tender.model.notePlaceholder')}
                className="w-full rounded border bg-transparent px-2 py-1 text-muted-foreground"
                value={cell?.note ?? ''}
                disabled={disabled}
                onChange={(e) => setNote(signal, e.target.value)}
              />
            </CardContent>
          </Card>
        )
        })}
      </div>
    </div>
  )
}
