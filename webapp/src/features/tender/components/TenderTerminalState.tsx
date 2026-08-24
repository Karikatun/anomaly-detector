import { Alert01Icon, ArrowLeft01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { translate } from '@/platform/i18n'

import styles from './TenderTerminalState.module.css'

type TenderTerminalStateProps = {
  kind: 'access' | 'audit'
  onRetry: () => void
  onReturnToHistory: () => void
}

const copy = {
  access: {
    description: 'tender.terminal.access.description',
    title: 'tender.terminal.access.title',
  },
  audit: {
    description: 'tender.terminal.audit.description',
    title: 'tender.terminal.audit.title',
  },
} as const

export function TenderTerminalState({
  kind,
  onRetry,
  onReturnToHistory,
}: TenderTerminalStateProps) {
  const headingId = `tender-${kind}-terminal-heading`

  return (
    <Card
      className={styles.state}
      data-terminal-state={kind}
      role="alert"
      aria-labelledby={headingId}
    >
      <CardHeader className={styles.header}>
        <span className={styles.icon} aria-hidden="true">
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} />
        </span>
        <div className={styles.copy}>
          <Typography id={headingId} as="h2" variant="h4">
            {translate(copy[kind].title)}
          </Typography>
          <Typography variant="bodySm" tone="muted">
            {translate(copy[kind].description)}
          </Typography>
        </div>
      </CardHeader>
      <CardContent className={styles.actions}>
        <Button type="button" variant="outline" onClick={onRetry}>
          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.7} aria-hidden="true" />
          {translate('tender.terminal.retry')}
        </Button>
        <Button type="button" onClick={onReturnToHistory}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.7} aria-hidden="true" />
          {translate('tender.terminal.history')}
        </Button>
      </CardContent>
    </Card>
  )
}
