import type { TutorialLessonId } from '@anomaly-detector/contracts'
import type { RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'

import styles from './TutorialLessonDialog.module.css'

type TutorialLesson = {
  id: TutorialLessonId
  label: string
  description: string
  status: string
  details?: readonly string[]
  actionLabel: string
}

type TutorialLessonDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  closeLabel: string
  lessons: readonly TutorialLesson[]
  onChoose: (id: TutorialLessonId) => void
  returnFocusTo: RefObject<HTMLButtonElement | null>
  notice?: string
}

export function TutorialLessonDialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  lessons,
  onChoose,
  returnFocusTo,
  notice,
}: TutorialLessonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={styles.content}
        closeLabel={closeLabel}
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo.current
          if (target?.isConnected && !target.disabled) {
            target.focus({ preventScroll: true })
            if (document.activeElement === target) event.preventDefault()
          }
        }}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {notice && <Typography variant="bodySm" tone="muted" className={styles.notice}>{notice}</Typography>}
        <div className={styles.lessons}>
          {lessons.map((lesson) => (
            <section key={lesson.id} className={styles.lesson} aria-labelledby={`tutorial-lesson-${lesson.id}`}>
              <div className={styles.lessonBody}>
                <Typography as="h3" variant="h6" id={`tutorial-lesson-${lesson.id}`}>{lesson.label}</Typography>
                <Typography variant="bodySm" tone="muted">{lesson.description}</Typography>
                <Typography variant="bodySmMedium" className={styles.status}>{lesson.status}</Typography>
                {lesson.details && lesson.details.length > 0 && (
                  <ul className={styles.details}>
                    {lesson.details.map((detail, index) => <Typography as="li" variant="bodySm" key={`${index}-${detail}`}>{detail}</Typography>)}
                  </ul>
                )}
              </div>
              <Button type="button" className={styles.action} aria-label={`${lesson.actionLabel}: ${lesson.label}`} onClick={() => onChoose(lesson.id)}>
                {lesson.actionLabel}
              </Button>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
