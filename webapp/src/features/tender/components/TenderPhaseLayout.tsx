import type { ReactNode } from 'react'

import styles from './TenderPhaseLayout.module.css'

const renderSlot = (slot: ReactNode) => slot

export function TenderPhaseLayout({
  primary,
  progress,
  sidebar,
}: {
  primary: ReactNode
  progress?: ReactNode
  sidebar?: ReactNode
}) {
  return (
    <div className={styles.shell}>
      {progress && <div className={styles.progress}>{renderSlot(progress)}</div>}
      <div className={styles.columns} data-has-sidebar={sidebar ? true : undefined}>
        <main className={styles.main}>
          {renderSlot(primary)}
        </main>
        {sidebar && <aside className={styles.sidebar}>{renderSlot(sidebar)}</aside>}
      </div>
    </div>
  )
}
