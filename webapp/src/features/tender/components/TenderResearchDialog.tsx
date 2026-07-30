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
  onOpenChange,
  open,
  view,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  view: TenderView
}) {
  const count = view.publicLaboratoryResults.length
    + view.privateMeasurements.length
    + (view.privateTheses?.length ?? 0)
    + view.publicTheses.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className={styles.trigger}>
          <Typography as="span" variant="bodySmMedium">Данные исследований</Typography>
          <Typography as="span" variant="caption" className={styles.count}>{count}</Typography>
        </Button>
      </DialogTrigger>
      <DialogContent className={styles.dialog} closeLabel="Закрыть данные исследований" placement="viewport">
        <DialogHeader className={styles.header}>
          <DialogTitle>Данные исследований</DialogTitle>
          <DialogDescription>Публичные и личные результаты, а также история тезисов</DialogDescription>
        </DialogHeader>
        <div className={styles.content}><TenderEvidence data={view} /></div>
      </DialogContent>
    </Dialog>
  )
}
