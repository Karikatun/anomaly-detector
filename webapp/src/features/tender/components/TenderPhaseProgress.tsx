import { translate } from '../../../platform/i18n'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Fragment } from 'react'

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
import { getTenderPhaseProgressStages } from '../phase-ui'
import styles from './TenderPhaseProgress.module.css'

export function TenderPhaseProgress({ phase }: { phase: string }) {
  const stages = getTenderPhaseProgressStages(phase as never)
  const activeIndex = stages.findIndex((stage) => stage.phase === phase)
  const activeStage = stages[activeIndex]

  return (
    <nav className={styles.progress} aria-label={translate('tender.tenderPhaseProgress.copy.001')}>
      <div className={styles.compactProgress}>
        <div className={styles.compactHeader}>
          <Typography as="strong" variant="bodySmMedium" className={styles.compactTitle}>
            {translate('tender.phaseProgress.current', {
              current: activeIndex + 1,
              total: stages.length,
              label: activeStage?.label ?? '',
            })}
          </Typography>
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" size="xs" variant="ghost" className={styles.allStagesAction}>
                
                {translate('tender.tenderPhaseProgress.copy.004')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{translate('tender.tenderPhaseProgress.copy.005')}</DialogTitle>
                <DialogDescription>{translate('tender.tenderPhaseProgress.copy.006')}</DialogDescription>
              </DialogHeader>
              <ol className={styles.stageList}>
                {stages.map((stage, index) => (
                  <li
                    key={stage.phase}
                    data-active={index === activeIndex || undefined}
                    data-completed={index < activeIndex || undefined}
                  >
                    <span aria-hidden="true">
                      {index < activeIndex
                        ? <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} />
                        : <Typography as="span" variant="caption">{index + 1}</Typography>}
                    </span>
                    <Typography as="strong" variant="bodySmMedium">{stage.label}</Typography>
                  </li>
                ))}
              </ol>
            </DialogContent>
          </Dialog>
        </div>
        <div
          className={styles.compactSegments}
          aria-hidden="true"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
        >
          {stages.map((stage, index) => (
            <span
              key={stage.phase}
              data-state={index < activeIndex ? 'completed' : index === activeIndex ? 'active' : 'pending'}
            />
          ))}
        </div>
      </div>

      <div className={styles.stages}>
        {stages.map((stage, index) => {
          const completed = index < activeIndex
          const active = index === activeIndex
          const connectorState = index + 1 < activeIndex
            ? 'completed'
            : index + 1 === activeIndex
              ? 'active'
              : 'pending'
          return (
            <Fragment key={stage.phase}>
              <div className={styles.stage} data-active={active || undefined} data-completed={completed || undefined}>
                <span className={styles.marker} aria-hidden="true">
                  {completed
                    ? <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} />
                    : <Typography as="span" variant="caption">{index + 1}</Typography>}
                </span>
                <span className={styles.copy}>
                  <Typography as="span" variant="bodySmMedium" className={styles.longLabel}>{stage.label}</Typography>
                </span>
              </div>
              {index < stages.length - 1 && <span className={styles.connector} data-state={connectorState} aria-hidden="true" />}
            </Fragment>
          )
        })}
      </div>
    </nav>
  )
}
