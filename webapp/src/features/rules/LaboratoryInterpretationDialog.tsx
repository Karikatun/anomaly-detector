import { FlaskConicalIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { useI18n } from '@/platform/i18n'
import { LaboratoryInterpretation } from './RulesReferenceDialog'
import styles from './RulesReferenceDialog.module.css'

export function LaboratoryInterpretationDialog({
  belowTenderHeader = false,
  disabled = false,
  onOpenChange,
  open,
  showTimerWarning = false,
  triggerClassName,
  triggerIconOnly = false,
  triggerTextClassName,
}: {
  belowTenderHeader?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
  showTimerWarning?: boolean
  triggerClassName?: string
  triggerIconOnly?: boolean
  triggerTextClassName?: string
}) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={triggerIconOnly ? 'icon-sm' : 'sm'}
          className={cn(triggerClassName)}
          disabled={disabled}
          title={triggerIconOnly ? t('rules.laboratory.open') : undefined}
        >
          <HugeiconsIcon icon={FlaskConicalIcon} strokeWidth={1.7} aria-hidden="true" />
          <Typography
            as="span"
            variant="control"
            className={cn(triggerIconOnly && 'sr-only', triggerTextClassName)}
          >
            {t('rules.laboratory.open')}
          </Typography>
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className={cn(styles.content, belowTenderHeader && styles.belowTenderHeader)}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle>{t('rules.laboratory.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('rules.laboratory.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className={styles.body}>
          {showTimerWarning && (
            <Typography role="status" variant="bodySm" className={styles.timerWarning}>
              {t('rules.timerContinues')}
            </Typography>
          )}
          <div className={styles.scrollArea}>
            <LaboratoryInterpretation />
          </div>
        </div>
        <DialogFooter className={styles.footer}>
          <DialogClose asChild>
            <Button type="button" variant="outline" className={styles.closeButton}>
              {t('rules.laboratory.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
