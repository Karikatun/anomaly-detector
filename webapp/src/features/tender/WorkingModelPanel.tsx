import { useEffect, useState } from 'react'

import type {
  FieldType,
  Polarity,
  SignalId,
  WorkingModel,
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
import {
  WorkingModelDraftController,
  type WorkingModelSaveStatus,
} from './working-model-draft'
import {
  transitionMarkerValue,
  type MarkerState,
} from './working-model-marker'

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
  knownSignals: SignalId[]
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

  const updateSignal = (signal: SignalId, cell: SignalCell) => {
    draftController.update({
      ...draft,
      signals: {
        ...draft.signals,
        [signal]: cell,
      },
    })
  }

  const getCell = (signal: SignalId): NonNullable<SignalCell> => {
    return draft.signals?.[signal] ?? {}
  }

  const toggleFieldType = (signal: SignalId, ft: FieldType, current: MarkerState) => {
    const cell = getCell(signal)
    const next = transitionMarkerValue(
      ft,
      current,
      cell.possibleFieldTypes ?? [],
      cell.excludedFieldTypes ?? [],
    )
    const isHypothesis = cell.hypothesis?.fieldType === ft

    updateSignal(signal, {
      ...cell,
      possibleFieldTypes: next.possible.length > 0 ? next.possible : undefined,
      excludedFieldTypes: next.excluded.length > 0 ? next.excluded : undefined,
      ...(isHypothesis ? { hypothesis: { ...cell.hypothesis!, fieldType: undefined } } : {}),
    })
  }

  const togglePolarity = (signal: SignalId, pol: Polarity, current: MarkerState) => {
    const cell = getCell(signal)
    const next = transitionMarkerValue(
      pol,
      current,
      cell.possiblePolarities ?? [],
      cell.excludedPolarities ?? [],
    )
    const isHypothesis = cell.hypothesis?.polarity === pol

    updateSignal(signal, {
      ...cell,
      possiblePolarities: next.possible.length > 0 ? next.possible : undefined,
      excludedPolarities: next.excluded.length > 0 ? next.excluded : undefined,
      ...(isHypothesis ? { hypothesis: { ...cell.hypothesis!, polarity: undefined } } : {}),
    })
  }

  const setHypothesis = (
    signal: SignalId,
    key: 'fieldType' | 'polarity',
    value: FieldType | Polarity,
  ) => {
    const cell = getCell(signal)
    const hyp = cell.hypothesis
    const hypothesis = key === 'fieldType'
      ? {
          ...hyp,
          fieldType: hyp?.fieldType === value ? undefined : value as FieldType,
        }
      : {
          ...hyp,
          polarity: hyp?.polarity === value ? undefined : value as Polarity,
        }
    updateSignal(signal, {
      ...cell,
      hypothesis,
    })
  }

  const setNote = (signal: SignalId, note: string) => {
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
        {signalIds.map((signal) => {
        const isKnown = knownSignals.includes(signal)
        const cell = draft.signals?.[signal]
        const hyp = cell?.hypothesis
        const signalName = t(signalLabelKeys[signal])

        return (
          <Card key={signal} size="sm" className={!isKnown ? 'opacity-40' : ''}>
            <CardContent className="grid gap-3 py-4">
              <Typography variant="bodySmMedium" className="text-center">
                {signalName}
              </Typography>

              {/* Field types */}
              <div role="group" aria-label={`${signalName}: возможные типы поля`}>
                <Typography variant="control" tone="muted" className="mb-1">{t('tender.model.fieldType')}</Typography>
                <div className="flex gap-1">
                  {fieldTypes.map((ft) => {
                    const marker: MarkerState = (cell?.excludedFieldTypes?.includes(ft) ?? false)
                      ? 'excluded'
                      : (cell?.possibleFieldTypes?.includes(ft) ?? false)
                        ? 'possible'
                        : 'unset'
                    const isHyp = hyp?.fieldType === ft
                    return (
                      <button
                        aria-label={`${signalName}: тип поля ${t(fieldTypeLabelKeys[ft])}, ${isHyp ? 'выбрано как гипотеза' : markerLabels[marker]}`}
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
                        onClick={() => { if (!isHyp) toggleFieldType(signal, ft, marker) }}
                      >
                        <Typography variant="control">{t(`tender.fieldShort.${ft}`)}</Typography>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Polarities */}
              <div role="group" aria-label={`${signalName}: возможные полярности`}>
                <Typography variant="control" tone="muted" className="mb-1">{t('tender.model.polarity')}</Typography>
                <div className="flex gap-1">
                  {polarities.map((pol) => {
                    const marker: MarkerState = (cell?.excludedPolarities?.includes(pol) ?? false)
                      ? 'excluded'
                      : (cell?.possiblePolarities?.includes(pol) ?? false)
                        ? 'possible'
                        : 'unset'
                    const isHyp = hyp?.polarity === pol
                    return (
                      <button
                        aria-label={`${signalName}: полярность ${t(polarityLabelKeys[pol])}, ${isHyp ? 'выбрано как гипотеза' : markerLabels[marker]}`}
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
                        onClick={() => { if (!isHyp) togglePolarity(signal, pol, marker) }}
                      >
                        <Typography variant="control">{pol === 'positive' ? '+' : '−'}</Typography>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Hypothesis */}
              <div role="group" aria-label={`${signalName}: гипотеза`}>
                <Typography variant="control" tone="muted" className="mb-1">{t('tender.model.hypothesis')}</Typography>
                <div className="grid grid-cols-2 gap-1">
                  <div className="grid gap-0.5">
                    {fieldTypes.map((ft) => (
                      <button
                        aria-label={`${signalName}: гипотеза, тип поля ${t(fieldTypeLabelKeys[ft])}`}
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
                        aria-label={`${signalName}: гипотеза, полярность ${t(polarityLabelKeys[pol])}`}
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
                aria-label={`${signalName}: заметка`}
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
