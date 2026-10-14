import { translate } from '../../platform/i18n'
import { useEffect } from 'react'

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
  type WorkingModelSaveStatus,
} from './working-model-draft'
import styles from './WorkingModelPanel.module.css'
import { useWorkingModelDraft, type WorkingModelDraft } from './use-working-model-draft'

type SignalCell = NonNullable<WorkingModel['signals'][keyof WorkingModel['signals']]>

type WorkingModelPanelProps = {
  model: WorkingModel
  knownSignals: SignalId[]
  disabled?: boolean
  onSave: (model: WorkingModel) => Promise<void>
  onSaveStatusChange?: (status: WorkingModelSaveStatus) => void
}

export function WorkingModelPanel(props: WorkingModelPanelProps) {
  const owner = useWorkingModelDraft(props.model, props.onSave)
  const { onSaveStatusChange } = props
  useEffect(() => { onSaveStatusChange?.(owner.status) }, [onSaveStatusChange, owner.status])
  return <WorkingModelEditor disabled={props.disabled} knownSignals={props.knownSignals} owner={owner} />
}

export function WorkingModelEditor({ disabled, knownSignals, owner }: {
  disabled?: boolean
  knownSignals: SignalId[]
  owner: WorkingModelDraft
}) {
  const { t } = useI18n()
  const draft = owner.model
  const saveStatus = owner.status

  const updateSignal = (signal: SignalId, cell: SignalCell) => {
    owner.update({
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
            
            {translate('tender.workingModelPanel.copy.001')}
          </Typography>
        )}
        {saveStatus.state === 'error' && (
          <div className="flex flex-wrap items-center gap-3">
            <Typography role="alert" variant="bodySm" tone="destructive">
              {saveStatus.message}
            </Typography>
            <Button type="button" variant="outline" size="sm" onClick={() => void owner.retry()}>
              
              {translate('tender.workingModelPanel.copy.002')}
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
            <div
              key={signal}
              className={styles.row}
              data-unknown={!isKnown || undefined}
              data-tutorial-working-model-row={signal}
            >
              <span className={styles.signal}>
                <SignalGlyph signal={signal} />
                <Typography as="strong" variant="bodySmMedium">{signalName}</Typography>
              </span>

              <div className={styles.segmented} role="group" aria-label={translate('tender.workingModelPanel.copy.003', { value1: signalName })}>
                {fieldTypes.map((fieldType) => (
                  <button
                    aria-label={translate('tender.workingModelPanel.copy.004', { value1: signalName, value2: t(fieldTypeLabelKeys[fieldType]) })}
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

              <div className={styles.segmented} data-options="2" role="group" aria-label={translate('tender.workingModelPanel.copy.005', { value1: signalName })}>
                {polarities.map((polarity) => (
                  <button
                    aria-label={translate('tender.workingModelPanel.copy.006', { value1: signalName, value2: t(polarityLabelKeys[polarity]) })}
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
