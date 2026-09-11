import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import { Card } from '@/components/ui/card'
import styles from './TutorialPage.module.css'

export function TutorialStateCard({
  alignCardToTop = false,
  children,
  showExpeditionBackground = true,
}: {
  alignCardToTop?: boolean
  children: React.ReactNode
  showExpeditionBackground?: boolean
}) {
  return (
    <section className={`${styles.statePage} ${alignCardToTop ? styles.statePageTopAligned : ''}`}>
      {showExpeditionBackground && <ExpeditionBackground />}
      <Card className={styles.stateCard}>{children}</Card>
    </section>
  )
}
