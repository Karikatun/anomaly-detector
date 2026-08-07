import { translate } from '../../../platform/i18n'
import type { TenderView } from '@anomaly-detector/contracts'

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
import { TenderEvidence } from './TenderOverview'
import styles from './TenderContextDialog.module.css'

export function TenderResearchDialog({
  contentTestId,
  onOpenChange,
  open,
  triggerTestId,
  view,
}: {
  contentTestId?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  triggerTestId?: string
  view: TenderView
}) {
  const count = view.publicLaboratoryResults.length
    + view.privateMeasurements.length
    + (view.privateTheses?.length ?? 0)
    + view.publicTheses.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid={triggerTestId} type="button" variant="outline" className={styles.trigger}>
          <Typography as="span" variant="bodySmMedium">{translate('tender.tenderResearchDialog.copy.001')}</Typography>
          <Typography as="span" variant="caption" className={styles.count}>{count}</Typography>
        </Button>
      </DialogTrigger>
      <DialogContent
        className={styles.dialog}
        closeLabel={translate('tender.tenderResearchDialog.copy.002')}
        data-testid={contentTestId}
        placement="viewport"
      >
        <DialogHeader className={styles.header}>
          <DialogTitle>{translate('tender.tenderResearchDialog.copy.003')}</DialogTitle>
          <DialogDescription>{translate('tender.tenderResearchDialog.copy.004')}</DialogDescription>
        </DialogHeader>
        <div className={styles.content}><TenderEvidence data={view} /></div>
      </DialogContent>
    </Dialog>
  )
}
