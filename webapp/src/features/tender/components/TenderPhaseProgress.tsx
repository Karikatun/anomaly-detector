import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Typography } from '@/components/ui/typography'
import styles from './TenderPhaseProgress.module.css'

const operationalStages = [
  { phase: 'reconnaissance', shortLabel: 'Разведка', label: 'Разведка' },
  { phase: 'laboratory', shortLabel: 'Лаборатория', label: 'Лаборатория' },
  { phase: 'model-analysis', shortLabel: 'Модель', label: 'Анализ модели' },
  { phase: 'contracts', shortLabel: 'Контракты', label: 'Контракты' },
] as const

export function TenderPhaseProgress({ phase }: { phase: string }) {
  const stages = phase === 'final-scientific-model'
    ? [
        ...operationalStages.slice(0, 3),
        { phase: 'final-scientific-model' as const, shortLabel: 'Финал', label: 'Финальная модель' },
      ]
    : operationalStages
  const activeIndex = stages.findIndex((stage) => stage.phase === phase)

  return (
    <nav className={styles.progress} aria-label="Прогресс фаз раунда">
      {stages.map((stage, index) => {
        const completed = index < activeIndex
        const active = index === activeIndex
        return (
          <div key={stage.phase} className={styles.stage} data-active={active || undefined} data-completed={completed || undefined}>
            {index > 0 && <span className={styles.connector} aria-hidden="true" />}
            <span className={styles.marker} aria-hidden="true">
              {completed
                ? <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} />
                : <Typography as="span" variant="caption">{index + 1}</Typography>}
            </span>
            <span className={styles.copy}>
              <Typography as="span" variant="bodySmMedium" className={styles.longLabel}>{stage.label}</Typography>
              <Typography as="span" variant="bodySmMedium" className={styles.shortLabel}>{stage.shortLabel}</Typography>
              <Typography as="span" variant="caption">
                {completed ? 'завершено' : active ? 'сейчас' : 'далее'}
              </Typography>
            </span>
          </div>
        )
      })}
    </nav>
  )
}
