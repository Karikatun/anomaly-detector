import { useRef } from 'react'

import { translate } from '../../../platform/i18n'
import { Alert01Icon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import styles from './PhasePanel.module.css'

type ReconnectOverlayProps = {
  errorText?: string
  open: boolean
  onRetry: () => void
}

export function ReconnectOverlay({ errorText, open, onRetry }: ReconnectOverlayProps) {
  const retryButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      {open && (
        <div className={styles.connectionBanner} role="status">
          <span className={styles.connectionPulse} aria-hidden="true" />
          <Typography as="strong" variant="bodySmMedium">{translate('tender.reconnectOverlay.copy.001')}</Typography>
          <Typography as="span" variant="caption" tone="muted">
            {translate('tender.reconnectOverlay.copy.002')}
          </Typography>
        </div>
      )}

      <Dialog open={open} modal>
        <DialogContent
          role="alertdialog"
          showCloseButton={false}
          className={`${styles.reconnectDialog} z-[var(--layer-system)]`}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            retryButtonRef.current?.focus()
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <span className={styles.reconnectIcon}>
            <HugeiconsIcon icon={Alert01Icon} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <DialogHeader className={styles.reconnectCopy}>
            <DialogTitle>{translate('tender.reconnectOverlay.copy.003')}</DialogTitle>
            <DialogDescription>{translate('tender.reconnectOverlay.copy.004')}</DialogDescription>
            {errorText && <Typography role="alert" variant="caption" tone="destructive">{errorText}</Typography>}
          </DialogHeader>
          <Button
            ref={retryButtonRef}
            type="button"
            size="lg"
            className={styles.actionButton}
            onClick={onRetry}
          >
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.7} aria-hidden="true" />
            {translate('tender.reconnectOverlay.copy.005')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
