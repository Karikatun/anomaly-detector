import { BookOpen01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tabs } from 'radix-ui'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { TenderView } from '@anomaly-detector/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { LaboratoryInterpretation } from '@/features/rules'
import { useI18n } from '@/platform/i18n'
import { WorkingModelEditor } from '../WorkingModelPanel'
import type { WorkingModelDraft } from '../use-working-model-draft'
import { TenderEvidence } from './TenderOverview'
import styles from './TenderJournalDialog.module.css'

export type TenderJournalTab = 'working-model' | 'research' | 'interpretation'

function JournalPanel({ active, children, onElementChange, onPositionChange, getPosition, value, visible }: {
  active: boolean
  children: ReactNode
  onElementChange: (element: HTMLDivElement | null) => void
  onPositionChange: (position: number) => void
  getPosition: () => number
  value: TenderJournalTab
  visible: boolean
}) {
  const element = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Restore after the portal and the visible panel have committed their layout.
    if (active && element.current) element.current.scrollTop = getPosition()
  }, [active, getPosition])
  return <Tabs.Content value={value} forceMount hidden={!visible} inert={!visible}
    className={styles.panel} data-interpretation-scroll-area={value === 'interpretation' ? '' : undefined}
    ref={(node) => { element.current = node; onElementChange(node) }}
    onScroll={(event) => {
      // Hiding or unmounting a panel can report zero; that is not a new viewing position.
      if (active) onPositionChange(event.currentTarget.scrollTop)
    }}
  >{children}</Tabs.Content>
}

export function TenderJournalDialog({
  actionError, disabled, modelTabDisabled, interpretationDisabled, onOpenChange, onTabChange,
  open, openDisabled, owner, tab, view, highlightResult, triggerTestId, showTimerWarning = true,
}: {
  actionError?: string | null
  disabled?: boolean
  modelTabDisabled?: boolean
  interpretationDisabled?: boolean
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: TenderJournalTab) => void
  open: boolean
  openDisabled?: boolean
  owner: WorkingModelDraft
  tab: TenderJournalTab
  view: TenderView
  showTimerWarning?: boolean
  highlightResult?: 'reflection'
  triggerTestId?: string
}) {
  const { t } = useI18n()
  const scroll = useRef<Partial<Record<TenderJournalTab, number>>>({})
  const panelElements = useRef<Partial<Record<TenderJournalTab, HTMLDivElement | null>>>({})
  const rememberPosition = () => {
    const element = panelElements.current[tab]
    if (open && element && element.clientHeight > 0) scroll.current[tab] = element.scrollTop
  }
  const opener = useRef<HTMLElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    const button = trigger.current
    const board = button?.closest('[data-tender-page], [data-tutorial-board]')
    const footer = board?.querySelector<HTMLElement>('[data-tender-primary-content] footer, [data-tutorial-primary] footer')
    if (!button || !footer) return
    const avoidAction = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const rect = footer.getBoundingClientRect()
      const overlapsEntry = window.innerWidth < 768 && rect.top < viewportHeight - 16
        && rect.bottom > viewportHeight - 72
      button.style.setProperty('--journal-action-clearance', overlapsEntry ? `${Math.max(0, viewportHeight - rect.top + 12 - 16)}px` : '0px')
    }
    const observer = new ResizeObserver(avoidAction)
    observer.observe(footer)
    avoidAction()
    window.addEventListener('scroll', avoidAction, { passive: true })
    window.addEventListener('resize', avoidAction)
    window.visualViewport?.addEventListener('resize', avoidAction)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', avoidAction)
      window.removeEventListener('resize', avoidAction)
      window.visualViewport?.removeEventListener('resize', avoidAction)
    }
  }, [view.phase, open])
  const panel = (value: TenderJournalTab, content: ReactNode) => (
    <JournalPanel key={value} value={value} active={open && tab === value} visible={tab === value}
      getPosition={() => scroll.current[value] ?? 0}
      onPositionChange={(position) => { scroll.current[value] = position }}
      onElementChange={(element) => { panelElements.current[value] = element }}>{content}</JournalPanel>
  )
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { rememberPosition(); onOpenChange(nextOpen) }}>
      <DialogTrigger asChild>
        <Button
          ref={trigger} variant="outline" type="button" className={styles.trigger}
          disabled={openDisabled} aria-label={t('tender.journal.open')}
          title={t('tender.journal.open')} data-testid={triggerTestId}
        >
          <HugeiconsIcon icon={BookOpen01Icon} strokeWidth={1.7} aria-hidden="true" />
          <Typography as="span" variant="bodySmMedium" className={styles.triggerText}>{t('tender.journal.title')}</Typography>
        </Button>
      </DialogTrigger>
      <DialogContent
        className={styles.dialog} placement="viewport" closeLabel={t('tender.journal.close')}
        data-tender-journal="" data-tutorial-journal={triggerTestId ? '' : undefined}
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected && !opener.current.hasAttribute('disabled')) {
            event.preventDefault()
            opener.current.focus({ preventScroll: true })
          }
        }}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle>{t('tender.journal.title')}</DialogTitle>
          <DialogDescription className={styles.description}>{t('tender.journal.description')}</DialogDescription>
          {showTimerWarning && <Typography role="status" variant="caption" tone="muted">{t('rules.timerContinues')}</Typography>}
        </DialogHeader>
        <Tabs.Root value={tab} onValueChange={(value) => { rememberPosition(); onTabChange(value as TenderJournalTab) }} className={styles.tabs}>
          <Tabs.List aria-label={t('tender.journal.sections')} className={styles.tablist}>
            <Tabs.Trigger value="working-model" disabled={modelTabDisabled} className={styles.tab}>{t('tender.journal.model')}</Tabs.Trigger>
            <Tabs.Trigger value="research" className={styles.tab}>{t('tender.journal.research')}</Tabs.Trigger>
            <Tabs.Trigger value="interpretation" disabled={interpretationDisabled} className={styles.tab}>{t('tender.journal.interpretation')}</Tabs.Trigger>
          </Tabs.List>
          {panel('working-model', <>
            <Typography variant="caption" tone="muted">{t(disabled ? 'tender.journal.readOnly' : 'tender.journal.privateModel')}</Typography>
            {actionError && <Typography role="alert" variant="bodySm" tone="destructive">{actionError}</Typography>}
            <WorkingModelEditor disabled={disabled} knownSignals={view.privateSamples} owner={owner} />
          </>)}
          {panel('research', <TenderEvidence data={view} />)}
          {panel('interpretation', <LaboratoryInterpretation ruleset={view.ruleset} highlightResult={highlightResult} />)}
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}
