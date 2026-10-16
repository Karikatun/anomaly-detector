import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogOpeningBoundary, DialogTitle } from '@/components/ui/dialog'
import { isCompactTouchDisplay, isLandscapeScreen, readMobileDisplay, subscribeScreenOrientation } from '@/platform/display/mobile-orientation'
import { useI18n } from '@/platform/i18n'
import styles from './MobilePortraitGuard.module.css'

export function MobilePortraitGuard({ active, children }: { active: boolean; children: ReactNode }) {
  const { t } = useI18n()
  const [phone] = useState(() => isCompactTouchDisplay(readMobileDisplay()))
  const [landscape, setLandscape] = useState(() => isLandscapeScreen(readMobileDisplay()))
  const lastLandscape = useRef(landscape)
  const previousFocus = useRef<HTMLElement | null>(null)
  const background = useRef<HTMLDivElement>(null)
  const blocked = active && phone && landscape

  useEffect(() => {
    if (!phone) return
    return subscribeScreenOrientation(() => {
      const nextLandscape = isLandscapeScreen(readMobileDisplay())
      if (active && nextLandscape && !lastLandscape.current && document.activeElement instanceof HTMLElement) {
        previousFocus.current = document.activeElement
      }
      lastLandscape.current = nextLandscape
      setLandscape(nextLandscape)
    })
  }, [active, phone])

  function restoreFocus(event: Event) {
    event.preventDefault()
    const target = previousFocus.current
    previousFocus.current = null
    if (target?.isConnected && target.getClientRects().length > 0
      && getComputedStyle(target).visibility !== 'hidden'
      && !target.closest('[inert], [hidden], [aria-hidden="true"]')
      && !target.matches(':disabled')) {
      target.focus({ preventScroll: true })
    } else {
      background.current?.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
    }
  }

  return (
    <>
      <div ref={background} inert={blocked || undefined}>
        <DialogOpeningBoundary deferNewDialogs={blocked}>
          {children}
        </DialogOpeningBoundary>
      </div>
      <Dialog open={blocked}>
        <DialogContent
          placement="viewport"
          showCloseButton={false}
          className={styles.guard}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={restoreFocus}
        >
          <div className={styles.message}>
            <DialogTitle>{t('app.portrait.title')}</DialogTitle>
            <DialogDescription>{t('app.portrait.description')}</DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
