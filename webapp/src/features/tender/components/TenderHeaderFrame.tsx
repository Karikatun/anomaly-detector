import type { ReactNode, Ref } from 'react'

import styles from '../TenderPage.module.css'

function HeaderArea({ children, className }: { children: ReactNode; className: string }) {
  return <div className={className}>{children}</div>
}

export function TenderHeaderFrame({
  actions,
  ariaLabel,
  headerRef,
  info,
  meta,
  timer,
}: {
  actions: ReactNode
  ariaLabel: string
  headerRef?: Ref<HTMLElement>
  info: ReactNode
  meta: ReactNode
  timer: ReactNode
}) {
  return (
    <header
      ref={headerRef}
      aria-label={ariaLabel}
      className={`${styles.header} sticky top-0 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:px-5 sm:py-3`}
    >
      <HeaderArea className={`${styles.headerInfo} grid min-w-0 gap-0.5`}>{info}</HeaderArea>
      <HeaderArea className={`${styles.headerTimer} justify-self-end`}>{timer}</HeaderArea>
      <HeaderArea className={`${styles.headerMeta} flex min-w-0 flex-wrap items-center gap-2`}>{meta}</HeaderArea>
      <HeaderArea className={`${styles.headerActions} flex items-center justify-self-end gap-1`}>{actions}</HeaderArea>
    </header>
  )
}
