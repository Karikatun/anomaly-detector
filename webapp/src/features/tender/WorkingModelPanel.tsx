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
import styles from './WorkingModelPanel.module.css'

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
          const hypothesis = draft.signals?.[signal]?.hypothesis
          const signalName = t(signalLabelKeys[signal])

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
              </div>

              <div className={styles.segmented} data-options="2" role="group" aria-label={`${signalName}: гипотеза, полярность`}>
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
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
