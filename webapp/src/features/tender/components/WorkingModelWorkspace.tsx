import { Analytics01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { SignalId, WorkingModel } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { WorkingModelPanel } from '../WorkingModelPanel'
import styles from './WorkingModelWorkspace.module.css'

type Props = {
  disabled?: boolean
  inlineOnDesktop?: boolean
  knownSignals: SignalId[]
  model: WorkingModel
  onSave: (model: WorkingModel) => Promise<void>
}

function WorkspaceModelPanel({
  disabled,
  knownSignals,
  model,
  onSave,
}: Pick<Props, 'disabled' | 'knownSignals' | 'model' | 'onSave'>) {
  return (
    <WorkingModelPanel
      disabled={disabled}
      knownSignals={knownSignals}
      model={model}
      onSave={onSave}
    />
  )
}

export function WorkingModelWorkspace({
  disabled,
  inlineOnDesktop = false,
  knownSignals,
  model,
  onSave,
}: Props) {
  return (
    <>
      {inlineOnDesktop && (
        <div className={styles.desktopPanel}>
          <WorkspaceModelPanel disabled={disabled} knownSignals={knownSignals} model={model} onSave={onSave} />
        </div>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className={inlineOnDesktop ? styles.mobileTrigger : styles.trigger}>
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="span" variant="bodySmMedium">Рабочая модель</Typography>
            <Typography as="span" variant="caption" className={styles.count}>{knownSignals.length} / 6</Typography>
          </Button>
        </DialogTrigger>
        <DialogContent className={styles.dialog} showCloseButton>
          <DialogHeader className={styles.header}>
            <span>
              <DialogTitle>Рабочая модель</DialogTitle>
              <DialogDescription>Ваши приватные гипотезы и метки</DialogDescription>
            </span>
          </DialogHeader>
          <div className={styles.content}>
            <WorkspaceModelPanel disabled={disabled} knownSignals={knownSignals} model={model} onSave={onSave} />
          </div>
          <Typography variant="caption" tone="muted" className={styles.hint}>
            Изменения сохраняются автоматически
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  )
}
