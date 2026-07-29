import { useEffect, useState } from 'react'

import type {
  FieldType,
  Polarity,
  SignalId,
  WorkingModel,
} from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
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
import { SignalGlyph } from './components/SignalGlyph'
import {
  WorkingModelDraftController,
  type WorkingModelSaveStatus,
} from './working-model-draft'
import {
  transitionMarkerValue,
  type MarkerState,
} from './working-model-marker'
import styles from './WorkingModelPanel.module.css'

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
  const [expandedSignal, setExpandedSignal] = useState<SignalId | null>(null)
  const [saveStatus, setSaveStatus] = useState<WorkingModelSaveStatus>({ state: 'idle' })
  const [draftController] = useState(() => new WorkingModelDraftController({
    cancel: (timer) => clearTimeout(timer),
    initialModel: model,
    onDraft: setDraft,
    onStatus: setSaveStatus,
    save: onSave,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  }))

  useEffect(() => {
    draftController.setSave(onSave)
  }, [draftController, onSave])

  useEffect(() => {
    draftController.receiveServerModel(model)
  }, [draftController, model])

  useEffect(() => {
    draftController.resume()
    return () => {
      void draftController.dispose()
    }
  }, [draftController])

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

  const toggleFieldType = (signal: SignalId, fieldType: FieldType, current: MarkerState) => {
    const cell = getCell(signal)
    const next = transitionMarkerValue(
      fieldType,
      current,
      cell.possibleFieldTypes ?? [],
      cell.excludedFieldTypes ?? [],
    )
    const isHypothesis = cell.hypothesis?.fieldType === fieldType

    updateSignal(signal, {
      ...cell,
      possibleFieldTypes: next.possible.length > 0 ? next.possible : undefined,
      excludedFieldTypes: next.excluded.length > 0 ? next.excluded : undefined,
      ...(isHypothesis ? { hypothesis: { ...cell.hypothesis!, fieldType: undefined } } : {}),
    })
  }

  const togglePolarity = (signal: SignalId, polarity: Polarity, current: MarkerState) => {
    const cell = getCell(signal)
    const next = transitionMarkerValue(
      polarity,
      current,
      cell.possiblePolarities ?? [],
      cell.excludedPolarities ?? [],
    )
    const isHypothesis = cell.hypothesis?.polarity === polarity

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
    const hypothesis = key === 'fieldType'
      ? {
          ...cell.hypothesis,
          fieldType: cell.hypothesis?.fieldType === value ? undefined : value as FieldType,
        }
      : {
          ...cell.hypothesis,
          polarity: cell.hypothesis?.polarity === value ? undefined : value as Polarity,
        }
    updateSignal(signal, { ...cell, hypothesis })
  }

  const clearHypothesis = (signal: SignalId, key: 'fieldType' | 'polarity') => {
    const cell = getCell(signal)
    updateSignal(signal, {
      ...cell,
      hypothesis: {
        ...cell.hypothesis,
        [key]: undefined,
      },
    })
  }

  const setNote = (signal: SignalId, note: string) => {
    const cell = getCell(signal)
    updateSignal(signal, { ...cell, note: note.slice(0, 1000) })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.saveStatus}>
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
            <Button type="button" variant="outline" size="sm" onClick={() => void draftController.retry()}>
              Повторить сохранение
            </Button>
          </div>
        )}
      </div>

      <div className={styles.table} data-testid="working-model-table">
        {signalIds.filter((signal) => knownSignals.includes(signal)).map((signal) => {
          const isKnown = knownSignals.includes(signal)
          const cell = draft.signals?.[signal]
          const hypothesis = cell?.hypothesis
          const signalName = t(signalLabelKeys[signal])
          const isExpanded = expandedSignal === signal

          return (
            <div key={signal} className={styles.row} data-unknown={!isKnown || undefined}>
              <span className={styles.signal}>
                <SignalGlyph signal={signal} />
                <Typography as="strong" variant="bodySmMedium">{signalName}</Typography>
              </span>

              <div className={styles.segmented} role="group" aria-label={`${signalName}: гипотеза, тип поля`}>
                {fieldTypes.map((fieldType) => (
                  <button
                    aria-label={`${signalName}: гипотеза, тип поля ${t(fieldTypeLabelKeys[fieldType])}`}
                    aria-pressed={hypothesis?.fieldType === fieldType}
                    data-selected={hypothesis?.fieldType === fieldType || undefined}
                    key={fieldType}
                    type="button"
                    disabled={disabled}
                    onClick={() => setHypothesis(signal, 'fieldType', fieldType)}
                  >
                    <Typography as="span" variant="caption">{t(`tender.fieldShort.${fieldType}`)}</Typography>
                  </button>
                ))}
                <button
                  aria-label={`${signalName}: гипотеза, тип поля не выбрано`}
                  aria-pressed={!hypothesis?.fieldType}
                  data-selected={!hypothesis?.fieldType || undefined}
                  type="button"
                  disabled={disabled}
                  onClick={() => clearHypothesis(signal, 'fieldType')}
                >
                  <Typography as="span" variant="caption">—</Typography>
                </button>
              </div>

              <div className={styles.segmented} data-options="3" role="group" aria-label={`${signalName}: гипотеза, полярность`}>
                {polarities.map((polarity) => (
                  <button
                    aria-label={`${signalName}: гипотеза, полярность ${t(polarityLabelKeys[polarity])}`}
                    aria-pressed={hypothesis?.polarity === polarity}
                    data-selected={hypothesis?.polarity === polarity || undefined}
                    key={polarity}
                    type="button"
                    disabled={disabled}
                    onClick={() => setHypothesis(signal, 'polarity', polarity)}
                  >
                    <Typography as="span" variant="caption">{polarity === 'positive' ? '+' : '−'}</Typography>
                  </button>
                ))}
                <button
                  aria-label={`${signalName}: гипотеза, полярность не выбрано`}
                  aria-pressed={!hypothesis?.polarity}
                  data-selected={!hypothesis?.polarity || undefined}
                  type="button"
                  disabled={disabled}
                  onClick={() => clearHypothesis(signal, 'polarity')}
                >
                  <Typography as="span" variant="caption">—</Typography>
                </button>
              </div>

              <button
                type="button"
                className={styles.advancedToggle}
                aria-expanded={isExpanded}
                aria-controls={`working-model-${signal}-advanced`}
                onClick={() => setExpandedSignal(isExpanded ? null : signal)}
              >
                <Typography as="span" variant="caption">{isExpanded ? 'Скрыть' : 'Метки'}</Typography>
              </button>

              <div
                id={`working-model-${signal}-advanced`}
                className={styles.advanced}
                data-open={isExpanded || undefined}
              >
                <div className={styles.markerGroup} role="group" aria-label={`${signalName}: возможные типы поля`}>
                  <Typography variant="caption" tone="muted">Метки типов поля</Typography>
                  <div className={styles.markerButtons}>
                    {fieldTypes.map((fieldType) => {
                      const marker: MarkerState = (cell?.excludedFieldTypes?.includes(fieldType) ?? false)
                        ? 'excluded'
                        : (cell?.possibleFieldTypes?.includes(fieldType) ?? false)
                          ? 'possible'
                          : 'unset'
                      const isHypothesis = hypothesis?.fieldType === fieldType
                      return (
                        <button
                          aria-label={`${signalName}: тип поля ${t(fieldTypeLabelKeys[fieldType])}, ${isHypothesis ? 'выбрано как гипотеза' : markerLabels[marker]}`}
                          aria-pressed={isHypothesis || marker !== 'unset'}
                          data-marker-state={isHypothesis ? 'hypothesis' : marker}
                          key={fieldType}
                          type="button"
                          disabled={disabled}
                          onClick={() => { if (!isHypothesis) toggleFieldType(signal, fieldType, marker) }}
                        >
                          <Typography as="span" variant="caption">{t(`tender.fieldShort.${fieldType}`)}</Typography>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className={styles.markerGroup} role="group" aria-label={`${signalName}: возможные полярности`}>
                  <Typography variant="caption" tone="muted">Метки полярности</Typography>
                  <div className={styles.markerButtons} data-options="2">
                    {polarities.map((polarity) => {
                      const marker: MarkerState = (cell?.excludedPolarities?.includes(polarity) ?? false)
                        ? 'excluded'
                        : (cell?.possiblePolarities?.includes(polarity) ?? false)
                          ? 'possible'
                          : 'unset'
                      const isHypothesis = hypothesis?.polarity === polarity
                      return (
                        <button
                          aria-label={`${signalName}: полярность ${t(polarityLabelKeys[polarity])}, ${isHypothesis ? 'выбрано как гипотеза' : markerLabels[marker]}`}
                          aria-pressed={isHypothesis || marker !== 'unset'}
                          data-marker-state={isHypothesis ? 'hypothesis' : marker}
                          key={polarity}
                          type="button"
                          disabled={disabled}
                          onClick={() => { if (!isHypothesis) togglePolarity(signal, polarity, marker) }}
                        >
                          <Typography as="span" variant="caption">{polarity === 'positive' ? '+' : '−'}</Typography>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <input
                  aria-label={`${signalName}: заметка`}
                  type="text"
                  placeholder={t('tender.model.notePlaceholder')}
                  className={styles.note}
                  value={cell?.note ?? ''}
                  disabled={disabled}
                  onChange={(event) => setNote(signal, event.target.value)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
