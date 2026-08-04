import { translate } from '../../../platform/i18n'
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
            data-tutorial-working-model-trigger=""
          >
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="span" variant="bodySmMedium">{translate('tender.workingModelWorkspace.copy.001')}</Typography>
            <Typography as="span" variant="caption" className={styles.count}>{knownSignals.length} / 6</Typography>
          </Button>
        </DialogTrigger>
        <DialogContent
          className={styles.dialog}
          closeLabel={translate('tender.workingModelWorkspace.copy.002')}
          data-working-model-dialog=""
          placement="viewport"
          showCloseButton
        >
          <DialogHeader className={styles.header}>
            <span>
              <DialogTitle>{translate('tender.workingModelWorkspace.copy.003')}</DialogTitle>
              <DialogDescription>{translate('tender.workingModelWorkspace.copy.004')}</DialogDescription>
            </span>
          </DialogHeader>
          <div className={styles.content}>
            <WorkspaceModelPanel
              disabled={disabled}
              knownSignals={knownSignals}
              model={model}
              onSave={onSave}
              onSaveStatusChange={onSaveStatusChange}
            />
          </div>
          <Typography variant="caption" tone="muted" className={styles.hint}>
            
            {translate('tender.workingModelWorkspace.copy.005')}
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  )
}
