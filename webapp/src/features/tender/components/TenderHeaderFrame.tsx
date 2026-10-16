import type { ReactNode, Ref } from 'react'

import styles from '../TenderPage.module.css'

function HeaderArea({ children, className }: { children: ReactNode; className: string }) {
  return <div className={className}>{children}</div>
}

export function TenderHeaderFrame({
  actions,
  ariaLabel,
  completed = false,
  headerRef,
  info,
  meta,
  timer,
}: {
  actions: ReactNode
  ariaLabel: string
  completed?: boolean
  headerRef?: Ref<HTMLElement>
  info: ReactNode
  meta: ReactNode
  timer: ReactNode
}) {
  return (
    <header
      ref={headerRef}
      aria-label={ariaLabel}
      data-completed={completed || undefined}
      className={`${styles.header} sticky top-0 min-w-0 rounded-xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:px-5 sm:py-3`}
    >
      <div className={styles.headerLayout}>
        <HeaderArea className={`${styles.headerInfo} grid min-w-0 gap-0.5`}>{info}</HeaderArea>
        <div className={styles.headerStatus}>
          <HeaderArea className={`${styles.headerTimer} justify-self-end`}>{timer}</HeaderArea>
          <HeaderArea className={`${styles.headerMeta} flex min-w-0 flex-wrap items-center gap-2`}>{meta}</HeaderArea>
        </div>
        <HeaderArea className={`${styles.headerActions} flex items-center justify-self-end gap-1`}>{actions}</HeaderArea>
      </div>
    </header>
  )
}
