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
import type { WorkingModelSaveStatus } from '../working-model-draft'
import styles from './WorkingModelWorkspace.module.css'

type Props = {
  disabled?: boolean
  inlineOnDesktop?: boolean
  knownSignals: SignalId[]
  model: WorkingModel
  onOpenChange?: (open: boolean) => void
  onSave: (model: WorkingModel) => Promise<void>
  onSaveStatusChange?: (status: WorkingModelSaveStatus) => void
  open?: boolean
  openDisabled?: boolean
  showTimerWarning?: boolean
}

function WorkspaceModelPanel({
  disabled,
  knownSignals,
  model,
  onSave,
  onSaveStatusChange,
}: Pick<Props, 'disabled' | 'knownSignals' | 'model' | 'onSave' | 'onSaveStatusChange'>) {
  return (
    <WorkingModelPanel
      disabled={disabled}
      knownSignals={knownSignals}
      model={model}
      onSave={onSave}
      onSaveStatusChange={onSaveStatusChange}
    />
  )
}

export function WorkingModelWorkspace({
  disabled,
  inlineOnDesktop = false,
  knownSignals,
  model,
  onOpenChange,
  onSave,
  onSaveStatusChange,
  open,
  openDisabled,
  showTimerWarning,
}: Props) {
  return (
    <>
      {inlineOnDesktop && (
        <div className={styles.desktopPanel}>
          <WorkspaceModelPanel
            disabled={disabled}
            knownSignals={knownSignals}
            model={model}
            onSave={onSave}
            onSaveStatusChange={onSaveStatusChange}
          />
        </div>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={openDisabled}
            className={inlineOnDesktop ? styles.mobileTrigger : styles.trigger}
          >
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="span" variant="bodySmMedium">Рабочая модель</Typography>
            <Typography as="span" variant="caption" className={styles.count}>{knownSignals.length} / 6</Typography>
          </Button>
        </DialogTrigger>
        <DialogContent
          className={styles.dialog}
          closeLabel="Закрыть рабочую модель"
          placement="viewport"
          showCloseButton
        >
          <DialogHeader className={styles.header}>
            <span>
              <DialogTitle>Рабочая модель</DialogTitle>
              <DialogDescription>Ваши приватные гипотезы</DialogDescription>
            </span>
          </DialogHeader>
          <div className={styles.content}>
            {showTimerWarning && (
              <Typography role="status" variant="bodySm" tone="muted">
                Таймер матча продолжает идти
              </Typography>
            )}
            <WorkspaceModelPanel
              disabled={disabled}
              knownSignals={knownSignals}
              model={model}
              onSave={onSave}
              onSaveStatusChange={onSaveStatusChange}
            />
          </div>
          <Typography variant="caption" tone="muted" className={styles.hint}>
            Изменения сохраняются автоматически
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  )
}
