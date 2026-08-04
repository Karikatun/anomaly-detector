import { translate } from '../../../platform/i18n'
import { Alert01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import styles from './PhasePanel.module.css'

type ReconnectOverlayProps = {
  errorText?: string
  onRetry: () => void
}

export function ReconnectOverlay({ errorText, onRetry }: ReconnectOverlayProps) {
  return (
    <>
      <div className={styles.connectionBanner} role="status">
        <span className={styles.connectionPulse} aria-hidden="true" />
        <Typography as="strong" variant="bodySmMedium">{translate('tender.reconnectOverlay.copy.001')}</Typography>
        <Typography as="span" variant="caption" tone="muted">
          
          {translate('tender.reconnectOverlay.copy.002')}
        </Typography>
      </div>

      <div className={styles.reconnectBackdrop}>
        <section
          className={styles.reconnectDialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="reconnect-heading"
          aria-describedby="reconnect-description"
        >
          <span className={styles.reconnectIcon}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <span className={styles.reconnectCopy}>
            <Typography id="reconnect-heading" as="h2" variant="h4">
              
              {translate('tender.reconnectOverlay.copy.003')}
            </Typography>
            <Typography id="reconnect-description" variant="bodySm" tone="muted">
              
              {translate('tender.reconnectOverlay.copy.004')}
            </Typography>
            {errorText && <Typography role="alert" variant="caption" tone="destructive">{errorText}</Typography>}
          </span>
          <Button type="button" size="lg" className={styles.actionButton} onClick={onRetry}>
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.7} aria-hidden="true" />
            
            {translate('tender.reconnectOverlay.copy.005')}
          </Button>
        </section>
      </div>
    </>
  )
}
