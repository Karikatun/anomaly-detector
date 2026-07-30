import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Fragment, useEffect, useRef } from 'react'

import { Typography } from '@/components/ui/typography'
import { getTenderPhaseProgressStages } from '../phase-ui'
import styles from './TenderPhaseProgress.module.css'

export function TenderPhaseProgress({ phase }: { phase: string }) {
  const stages = getTenderPhaseProgressStages(phase as never)
  const activeIndex = stages.findIndex((stage) => stage.phase === phase)
  const progressRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const progress = progressRef.current
    const active = progress?.querySelector<HTMLElement>('[data-active]')
    if (!progress || !active) return
    const bounds = progress.getBoundingClientRect()
    const activeBounds = active.getBoundingClientRect()
    if (activeBounds.left >= bounds.left && activeBounds.right <= bounds.right) return
    active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [phase])

  return (
    <nav ref={progressRef} className={styles.progress} aria-label="Прогресс фаз раунда">
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
                <Typography as="span" variant="bodySmMedium" className={styles.shortLabel}>{stage.shortLabel}</Typography>
              </span>
            </div>
            {index < stages.length - 1 && <span className={styles.connector} data-state={connectorState} aria-hidden="true" />}
          </Fragment>
        )
      })}
    </nav>
  )
}
