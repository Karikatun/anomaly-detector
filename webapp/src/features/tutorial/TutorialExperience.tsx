import { createPortal } from 'react-dom'
import { type MouseEvent, type ReactElement, type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { TranslationKey } from '@/platform/i18n/translations'
import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import {
  TutorialTenderBoard,
  type TenderCommandInput,
} from '@/features/tender/public/tutorial-board'
import { useI18n } from '@/platform/i18n'
import { MetrikaConsent } from '@/platform/analytics/MetrikaConsent'
import {
  advanceTutorial,
  createTutorialState,
  tutorialView,
  tutorialPowerGoals,
  type TutorialAdvanceResult,
  type TutorialAction,
  type TutorialStep,
  type TutorialState,
} from './scenario'
import { clearTutorialSession, type TutorialTimeline } from './session'
import { baseTutorialStepNumbers, isActiveBaseStep } from './base-steps'
import { useTutorialTimeline } from './use-tutorial-timeline'
import { resolveTutorialPresentation, tutorialSafeVerticalBounds, tutorialScrollDelta } from './tutorial-layout'
import styles from './TutorialPage.module.css'

type ActiveStep = keyof typeof baseTutorialStepNumbers
type GuidedStep = Exclude<ActiveStep, 'prologue'>
const taskKeys: Record<GuidedStep, TranslationKey> = {
  'round-1-access': 'tutorial.step.round1Access',
  'round-1-power': 'tutorial.step.round1Power',
  'round-1-recon': 'tutorial.step.round1Recon',
  'round-1-lab-mode': 'tutorial.step.round1LabMode',
  'round-1-lab-pair': 'tutorial.step.round1LabPair',
  'research-results': 'tutorial.step.researchResults',
  'research-results-open': 'tutorial.step.researchResultsOpen',
  interpretation: 'tutorial.step.interpretation',
  'interpretation-open': 'tutorial.step.interpretationOpen',
  'round-1-working-model': 'tutorial.step.round1Model',
  'round-1-thesis': 'tutorial.step.round1Thesis',
  'round-1-thesis-result': 'tutorial.step.round1ThesisResult',
  'final-model': 'tutorial.step.finalModel',
}

function restoredJournalTab(step: TutorialStep) {
  if (step === 'research-results-open') return 'research'
  if (step === 'interpretation-open') return 'interpretation'
  if (step === 'round-1-working-model') return 'working-model'
}

// Only this first research cycle uses the pilot presentation; lesson policy stays in scenario.ts.
const pilotCopy: Partial<Record<TutorialStep, { action: TranslationKey; why: TranslationKey }>> = {
  'round-1-access': { action: 'tutorial.pilot.access.action', why: 'tutorial.pilot.access.why' },
  'round-1-power': { action: 'tutorial.pilot.power.action', why: 'tutorial.pilot.power.why' },
  'round-1-recon': { action: 'tutorial.pilot.recon.action', why: 'tutorial.pilot.recon.why' },
  'round-1-lab-mode': { action: 'tutorial.pilot.mode.action', why: 'tutorial.pilot.mode.why' },
  'round-1-lab-pair': { action: 'tutorial.pilot.pair.action', why: 'tutorial.pilot.pair.why' },
  'research-results': { action: 'tutorial.pilot.result.action', why: 'tutorial.pilot.result.why' },
  'research-results-open': { action: 'tutorial.pilot.read.action', why: 'tutorial.pilot.read.why' },
}

const mobileActionPinnedSteps = new Set<TutorialStep>([
  'round-1-access', 'round-1-power', 'round-1-recon', 'round-1-lab-pair', 'round-1-thesis',
])

export function TutorialExperience({
  initialState,
  initialTimeline,
  onComplete,
  onExit,
  exitLabel,
  renderCompletion,
  storageNotice,
}: {
  initialState: TutorialState
  initialTimeline: TutorialTimeline<TutorialState> | null
  onComplete?: (state: TutorialState, signal: AbortSignal) => Promise<void>
  onExit: () => void
  exitLabel: TranslationKey
  renderCompletion: (restart: () => void, state: TutorialState) => ReactNode
  storageNotice?: string | null
}) {
  const { t } = useI18n()
  const timeline = useTutorialTimeline(initialState, initialTimeline)
  const { state, storage, storageUnavailable } = timeline
  const [lesson, setLesson] = useState(() => new AbortController())
  const [runEpoch, setRunEpoch] = useState(0)
  const [focusEpoch, setFocusEpoch] = useState(0)
  const callbacksActive = () => timeline.isMounted() && !lesson.signal.aborted
  const playerId = initialState.playerId
  const [commandError, setCommandError] = useState<string | null>(null)
  const [thesisFeedback, setThesisFeedback] = useState<NonNullable<TutorialAdvanceResult['thesisFeedback']> | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  const [explanationStep, setExplanationStep] = useState<TutorialStep | null>(null)
  const [requiredModalOpen, setRequiredModalOpen] = useState(false)
  const [journal, setJournal] = useState<{ open: boolean; activityKey: string | null }>({ open: false, activityKey: null })
  const journalOpen = journal.open
  const prologueRef = useRef<HTMLDivElement>(null)
  const coachExitRef = useRef<HTMLButtonElement | null>(null)
  const exitOpener = useRef<{ element: HTMLButtonElement; coach: boolean; readingOffset: number; closing: boolean } | null>(null)
  const restoreExitFocus = useCallback(() => {
    const opener = exitOpener.current
    if (!opener?.closing) return
    const target = opener.coach ? coachExitRef.current : opener.element
    if (!target?.isConnected) return
    if (opener.coach) {
      const reading = target.closest<HTMLElement>('[data-tutorial-step]')
      if (reading) reading.scrollTop = opener.readingOffset
    }
    target.focus({ preventScroll: true })
    exitOpener.current = null
  }, [])
  const setCoachExitButton = useCallback((button: HTMLButtonElement | null) => {
    coachExitRef.current = button
    restoreExitFocus()
  }, [restoreExitFocus])
  const requestExit = (event?: MouseEvent<HTMLButtonElement>) => {
    // Both concrete Exit buttons forward their click; only the coach unmounts.
    const element = event?.currentTarget
    exitOpener.current = element ? {
      element, coach: element === coachExitRef.current,
      readingOffset: element.closest<HTMLElement>('[data-tutorial-step]')?.scrollTop ?? 0,
      closing: false,
    } : null
    setExitOpen(true)
  }
  const manualReadingTasks = useRef(new Set<string>())
  useLayoutEffect(() => { manualReadingTasks.current.clear() }, [lesson])
  const nearest = useTutorialNearestAction(state.step)
  const [resolvedTarget, setResolvedTarget] = useState<{ requested: string; selector: string } | null>(null)
  const resolveTarget = useCallback((requested: string, selector: string) => {
    setResolvedTarget((current) => current?.requested === requested && current.selector === selector
      ? current : { requested, selector })
  }, [])
  const [compactHeader, setCompactHeader] = useState(
    () => window.matchMedia('(max-width: 47.999rem)').matches,
  )
  const [compactGuidance, setCompactGuidance] = useState(
    () => window.matchMedia('(max-width: 68rem)').matches,
  )


  useLayoutEffect(() => {
    if (!exitOpen && !requiredModalOpen) return
    const board = document.querySelector<HTMLElement>('[data-tutorial-board]')
    board?.style.setProperty('--tutorial-header-layer', 'var(--layer-sticky)')
    return () => { board?.style.removeProperty('--tutorial-header-layer') }
  }, [exitOpen, requiredModalOpen])

  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 47.999rem)')
    const syncViewport = () => setCompactHeader(media.matches)
    syncViewport()
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])

  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 68rem)')
    const syncViewport = () => setCompactGuidance(media.matches)
    syncViewport()
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])



  useLayoutEffect(() => {
    if (!focusEpoch) return
    const frame = requestAnimationFrame(() => {
      const coach = document.querySelector<HTMLElement>('[data-tutorial-step]')
      const target = coach?.querySelector<HTMLElement>('[data-tutorial-back]:enabled') ?? coach
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusEpoch])

  const resetBoard = (journalTab?: ReturnType<typeof restoredJournalTab>) => {
    // Abort before remounting. An old journal or draft controller can flush
    // during disposal, after the active step has already moved.
    lesson.abort()
    setLesson(new AbortController())
    setRunEpoch((epoch) => epoch + 1)
    setJournal({ open: journalTab !== undefined, activityKey: null })
    setRequiredModalOpen(false)
    setResolvedTarget(null)
    setCommandError(null)
    setThesisFeedback(null)
    setExplanationStep(null)
  }

  const applyAction = async (action: TutorialAction) => {
    if (!callbacksActive()) return false
    const before = timeline.currentState()
    if (before.step === 'complete') return false
    const result = advanceTutorial(before, action)
    const stepChanged = result.state.step !== before.step
    if (action.type === 'submit-thesis') setThesisFeedback(result.thesisFeedback ?? null)
    else if (stepChanged) setThesisFeedback(null)
    if (stepChanged) setExplanationStep(null)

    if (action.type === 'restart-exercise' && result.progressed) {
      resetBoard()
      timeline.commit(result.state, 'reset')
      return true
    }
    const journalReopen = before.step === 'interpretation' && result.state.step === 'interpretation-open'
    const journalClose = action.type === 'close-journal' || action.type === 'close-interpretation' || action.type === 'close-research-results'
    const journalRetreat = journalClose && result.state.step === 'research-results'
    const interpretationClosed = journalClose && result.state.step === 'interpretation'
    timeline.commit(result.state, journalRetreat ? 'retreat' : journalReopen || interpretationClosed ? 'edit' : 'advance')
    const isDraftSave = action.type === 'update-scientific-model-draft' || action.type === 'update-working-model'
    const isNavigation = action.type.startsWith('open-') || action.type.startsWith('close-')
    const isThesisAttempt = action.type === 'submit-thesis' && result.thesisFeedback !== undefined
    setCommandError(result.progressed || isDraftSave || isThesisAttempt || isNavigation
      ? null
      : t(before.step === 'round-1-power' ? 'tutorial.coach.powerRound1Invalid' : 'tutorial.coach.invalid'))

    if (result.state.step === 'complete') await onComplete?.(result.state, lesson.signal)
    return result.progressed
  }

  const back = () => {
    if (!callbacksActive() || !timeline.back((previous) => resetBoard(restoredJournalTab(previous.step)))) return
    setFocusEpoch((epoch) => epoch + 1)
  }

  const restart = () => {
    const fresh = createTutorialState(playerId)
    resetBoard()
    clearTutorialSession(storage, playerId)
    timeline.restart(fresh)
  }

  const exit = () => {
    exitOpener.current = null
    lesson.abort()
    clearTutorialSession(storage, playerId)
    setExitOpen(false)
    onExit()
  }

  if (state.step === 'prologue') {
    return (
      <section className={styles.statePage}>
        <ExpeditionBackground />
        <Dialog open>
          <DialogContent
            ref={prologueRef}
            className={styles.prologueDialog}
            showCloseButton={false}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              prologueRef.current?.focus({ preventScroll: true })
            }}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>{t('tutorial.prologue.title')}</DialogTitle>
              <DialogDescription>{t('tutorial.prologue.description')}</DialogDescription>
            </DialogHeader>
            <div className={styles.stateContent}>
              <Typography>{t('tutorial.prologue.mission')}</Typography>
              {storageNotice && <Typography role="status">{storageNotice}</Typography>}
              <Typography tone="muted">{t('tutorial.prologue.goal')}</Typography>
              <MetrikaConsent inline />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onExit}>
                {t(exitLabel)}
              </Button>
              <Button onClick={() => void applyAction({ type: 'start-tutorial' })}>
                {t('tutorial.prologue.start')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    )
  }

  if (state.step === 'complete') return renderCompletion(restart, state)

  if (!isActiveBaseStep(state.step)) return null

  const currentTaskKey = compactHeader && state.step === 'research-results'
    ? 'tutorial.step.researchResultsMobile' : taskKeys[state.step]
  const phaseTargetConfig: Record<GuidedStep, { anchor: string; fallback?: string; spotlight?: string; secondary?: string }> = {
    'round-1-access': { anchor: '[data-tutorial-access-slot="6"]' },
    'round-1-power': {
      anchor: '[data-tutorial-power-category="reconnaissance"]',
      spotlight: '[data-tutorial-power-options]',
    },
    'round-1-recon': {
      anchor: '[data-tutorial-recon-target="aster"]',
      spotlight: '[data-tutorial-recon-options]',
    },
    'round-1-lab-mode': { anchor: '[data-tutorial-lab-modes]' },
    'round-1-lab-pair': {
      anchor: '[data-tutorial-lab-sample="aster"]',
      spotlight: '[data-tutorial-lab-pair]',
    },
    'research-results': { anchor: '[data-testid="tutorial-research-trigger"]' },
    'research-results-open': {
      anchor: '[data-tender-journal] [data-research-experiment]:first-child > p:first-of-type',
      secondary: '[data-tutorial-journal-tab="interpretation"]',
    },
    interpretation: { anchor: '[data-testid="tutorial-research-trigger"]' },
    'interpretation-open': { anchor: '[data-tutorial-journal-tab="working-model"]' },
    'round-1-working-model': {
      anchor: journalOpen
        ? '[data-tender-journal] [data-tutorial-working-model-row="aster"]'
        : '[data-testid="tutorial-research-trigger"]',
      fallback: journalOpen ? '[data-tender-journal] [data-tutorial-working-model-row="aster"] [role="group"]:not([data-options])' : undefined,
    },
    'round-1-thesis': {
      anchor: '[data-tutorial-thesis]',
      fallback: '[data-tutorial-thesis] select',
      spotlight: '[data-tutorial-thesis]',
    },
    'round-1-thesis-result': { anchor: '[data-testid="tutorial-research-trigger"]' },
    'final-model': { anchor: '[data-tutorial-primary]' },
  }
  const pilot = pilotCopy[state.step]
  const requestedTarget = nearest?.selector ? { anchor: nearest.selector } : phaseTargetConfig[state.step]
  const activityKey = `${state.step}:${nearest?.fallbackSelector ?? phaseTargetConfig[state.step].fallback ?? requestedTarget.anchor}`
  const targetConfig = resolvedTarget?.requested === requestedTarget.anchor
    && resolvedTarget.selector !== requestedTarget.anchor
    ? { anchor: resolvedTarget.selector } : requestedTarget
  const presentation = resolveTutorialPresentation({
    anchor: targetConfig.anchor,
    compactGuidance,
    compactHeader,
    spotlight: targetConfig.spotlight,
    step: state.step,
  })
  const highlight = state.step.startsWith('research-results') || state.step === 'round-1-thesis-result'
    ? 'research'
    : state.step === 'interpretation' || state.step === 'interpretation-open'
      ? 'interpretation'
      : state.step === 'round-1-working-model' ? 'working-model' : 'primary'
  const informational = state.step === 'round-1-thesis-result'
  const coachContent = (
    <CoachContent
      progress={t('tutorial.coach.progress', { current: baseTutorialStepNumbers[state.step], total: baseTutorialStepNumbers['final-model'] })}
      onReset={state.step === 'round-1-thesis' && state.thesisAttempts >= (state.allocation?.modelAnalysis ?? 0) ? () => void applyAction({ type: 'restart-exercise' }) : undefined}
      onContinue={informational ? () => void applyAction({ type: 'continue' }) : undefined}
      onBack={back}
      canGoBack={timeline.canGoBack}
      onExit={requestExit}
      exitButtonRef={setCoachExitButton}
      pilot={pilot ? {
        action: t(nearest?.action ?? pilot.action, nearest?.values),
        why: t(pilot.why),
        expanded: explanationStep === state.step,
        onToggle: () => setExplanationStep(explanationStep === state.step ? null : state.step),
      } : undefined}
      task={t(currentTaskKey)}
      thesisFeedback={thesisFeedback}
    />
  )

  const journalGuidanceOpen = journalOpen

  return (
    <>
      {(storageUnavailable || storageNotice) && <Typography role="status" variant="bodySm">{storageUnavailable ? t('tutorial.base.storage') : storageNotice}</Typography>}
      {!exitOpen && !requiredModalOpen && (
        <TutorialViewportAnchor
          tutorialStep={state.step}
          activityKey={activityKey}
          restoreJournalFocus={!journalOpen && journal.activityKey === activityKey}
          manualReadingTasks={manualReadingTasks}
          anchorSelector={requestedTarget.anchor}
          secondarySelector={requestedTarget.secondary}
          fallbackSelector={nearest?.fallbackSelector ?? phaseTargetConfig[state.step].fallback}
          onTargetResolved={resolveTarget}
          compactLayout={compactHeader}
          journalEntryAllowed={!informational}
          spotlightSelector={presentation.spotlightTarget}
          blockTargetInteraction={informational}
          showSpotlightStroke={!journalOpen}
          children={!journalGuidanceOpen ? (
            <Card role="alertdialog" tabIndex={-1} aria-modal="true" aria-labelledby="tutorial-coach-title"
              className={styles.coachCard} data-tutorial-step={state.step}
              data-tutorial-pilot={Boolean(pilot) || undefined} size="sm">
              <CardContent>{coachContent}</CardContent>
            </Card>
          ) : undefined}
        />
      )}
      <Typography aria-live="polite" variant="srOnly">{pilot ? `${t(nearest?.action ?? pilot.action, nearest?.values)} ${t(pilot.why)}` : t(currentTaskKey)}</Typography>
      <TutorialTenderBoard
        key={`${state.playerId}:${runEpoch}`}
        journalGuidance={journalGuidanceOpen && !exitOpen && !requiredModalOpen ? (
          <Card tabIndex={-1} className={`${styles.coachCard} ${styles.journalCoach}`} data-testid="floater"
            data-tutorial-step={state.step} data-tutorial-pilot={Boolean(pilot) || undefined} size="sm" aria-labelledby="tutorial-coach-title">
            <CardContent>{coachContent}</CardContent>
          </Card>
        ) : undefined}
        actionPanelPinned={mobileActionPinnedSteps.has(state.step)}
        commandError={commandError}
        highlight={exitOpen ? 'none' : highlight}
        interpretationRequired={informational}
        initialJournalTab={journalOpen ? restoredJournalTab(state.step) : undefined}
        roundCount={1}
        laboratoryInitialMode={state.step === 'round-1-lab-pair' ? 'deep' : undefined}
        onCommand={async (command: TenderCommandInput) => {
          await applyAction(command)
        }}
        onExitRequest={(event?: MouseEvent<HTMLButtonElement>) => { if (callbacksActive()) requestExit(event) }}
        onHelpMenuOpened={() => void applyAction({ type: 'open-help-menu' })}
        onDirectInterpretationOpened={() => void applyAction({ type: 'open-interpretation-direct' })}
        onContractsClosed={() => void applyAction({ type: 'close-contracts-review' })}
        onContractsOpened={() => void applyAction({ type: 'open-contracts-review' })}
        onInterpretationOpened={() => void applyAction({ type: 'open-interpretation' })}
        onLaboratoryModeSelected={(mode) => void applyAction({ type: 'select-laboratory-mode', mode })}
        onJournalClosed={(workingModel) => void applyAction({ type: 'close-journal', workingModel })}
        onJournalOpenChange={(open) => { if (callbacksActive()) setJournal((current) => ({ open, activityKey: open ? activityKey : current.activityKey })) }}
        onWorkingModelOpened={() => void applyAction({ type: 'open-working-model' })}
        onResearchOpened={() => void applyAction({ type: 'open-research-results' })}
        onRequiredModalOpenChange={(open) => { if (callbacksActive()) setRequiredModalOpen(open) }}
        onSaveWorkingModel={(workingModel) => applyAction({ type: 'update-working-model', workingModel })}
        view={tutorialView(state)}
      />
      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent className={styles.exitDialog} onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (exitOpener.current) exitOpener.current.closing = true
          // Closing and the asynchronous coach remount can finish in either order.
          restoreExitFocus()
        }}>
          <DialogHeader>
            <DialogTitle>{t('tutorial.exit.title')}</DialogTitle>
            <DialogDescription>{t('tutorial.exit.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t('tutorial.exit.cancel')}</Button></DialogClose>
            <Button variant="destructive" onClick={exit}>{t('tutorial.exit.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type NearestAction = { selector: string; fallbackSelector?: string; action?: TranslationKey; values?: Record<string, string | number> }

// Read only semantic selection facts. The lesson owns the required values and
// the form remains the only owner of its reversible selection.
function useTutorialNearestAction(step: TutorialStep) {
  const [selection, setSelection] = useState<{ step: TutorialStep; action: NearestAction } | null>(null)
  useLayoutEffect(() => {
    const board = document.querySelector('[data-tutorial-board]')
    if (!board) return
    const confirm = '[data-tutorial-action-container] button[data-tutorial-confirm-ready="true"]'
    const resolve = (): NearestAction | null => {
      if (step === 'round-1-access') {
        const slot = 6
        return board.querySelector(`[data-tutorial-access-slot="${slot}"][aria-pressed="true"]`)
          ? { selector: confirm, action: 'tutorial.pilot.access.confirm' }
          : { selector: `[data-tutorial-access-slot="${slot}"]` }
      }
      if (step === 'round-1-power') {
        const categories = ['reconnaissance', 'laboratory', 'modelAnalysis'] as const
        for (const [index, category] of categories.entries()) {
          const card = board.querySelector<HTMLElement>(`[data-tutorial-power-category="${category}"]`)
          if (card && Number(card.dataset.tutorialPowerValue) !== tutorialPowerGoals[step][index]) {
            return {
              selector: `[data-tutorial-power-category="${category}"]`,
              fallbackSelector: `[data-tutorial-power-category="${category}"] [role="group"]`,
              action: `tutorial.pilot.power.${category}`,
              values: { count: tutorialPowerGoals[step][index]! },
            }
          }
        }
        // A valid allocation may deliberately keep reserve. The shared ready
        // marker means every power was spent and is absent before its warning.
        return { selector: '[data-tutorial-action-container] button', action: 'tutorial.pilot.power.confirm' }
      }
      if (step === 'round-1-recon') {
        return board.querySelector(confirm)
          ? { selector: confirm, action: 'tutorial.pilot.recon.confirm' }
          : { selector: '[data-tutorial-recon-target="aster"]' }
      }
      if (step === 'round-1-lab-mode') return { selector: '[data-tutorial-lab-modes] button:first-child' }
      if (step === 'round-1-lab-pair') {
        const source = board.querySelector('[data-tutorial-lab-sample="aster"][data-role="source"]')
        const receiver = board.querySelector('[data-tutorial-lab-sample="boreal"][data-role="receiver"]')
        if (!source) return { selector: '[data-tutorial-lab-sample="aster"]', action: 'tutorial.pilot.pair.source' }
        if (!receiver) return { selector: '[data-tutorial-lab-sample="boreal"]', action: 'tutorial.pilot.pair.receiver' }
        return { selector: confirm, action: 'tutorial.pilot.pair.confirm' }
      }
      if (step === 'round-1-thesis') {
        const selector = '[data-tutorial-thesis]'
        const fields = [...board.querySelectorAll<HTMLSelectElement>(`${selector} select`)]
        const nextField = fields.findIndex((field) => !field.value)
        return {
          selector,
          fallbackSelector: nextField < 0
            ? '[data-tutorial-action-container] button'
            : `${selector} > label:nth-child(${nextField + 1}) select`,
        }
      }
      return null
    }
    const sync = () => {
      const action = resolve()
      setSelection((current) => action && (current?.step !== step
        || JSON.stringify(current.action) !== JSON.stringify(action)) ? { step, action } : current)
    }
    const observer = new MutationObserver(sync)
    observer.observe(board, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['aria-pressed', 'data-tutorial-power-value', 'data-role', 'data-tutorial-confirm-ready'] })
    board.addEventListener('change', sync)
    sync()
    return () => { observer.disconnect(); board.removeEventListener('change', sync) }
  }, [step])
  return selection?.step === step ? selection.action : null
}

function TutorialViewportAnchor({ tutorialStep, activityKey, restoreJournalFocus, manualReadingTasks, anchorSelector, secondarySelector, fallbackSelector, onTargetResolved, compactLayout, journalEntryAllowed, spotlightSelector, blockTargetInteraction, showSpotlightStroke, children }: {
  tutorialStep: TutorialStep
  activityKey: string
  restoreJournalFocus: boolean
  manualReadingTasks: RefObject<Set<string>>
  anchorSelector: string
  secondarySelector?: string
  fallbackSelector?: string
  onTargetResolved: (requested: string, selector: string) => void
  compactLayout: boolean
  journalEntryAllowed: boolean
  spotlightSelector: string
  blockTargetInteraction: boolean
  showSpotlightStroke: boolean
  children?: ReactElement
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const identity = `${tutorialStep}:${anchorSelector}:${fallbackSelector}:${spotlightSelector}:${Boolean(children)}`
  const [mask, setMask] = useState<{ identity: string; width: number; height: number; frame: string; spotlight: string; secondary: string } | null>(null)
  const visibleMask = mask?.identity === identity ? mask : null
  useLayoutEffect(() => {
    const root = document.documentElement
    // Keep measured document clearances while the selected control changes.
    // Restoring fallback padding between measurements can clamp scrolling
    // before Firefox updates the visual viewport's origin.
    return () => {
      root.style.removeProperty('--tutorial-pilot-coach-height')
      root.style.removeProperty('--tutorial-pilot-header-height')
    }
  }, [])
  useLayoutEffect(() => {
    const root = document.documentElement
    let frame = 0
    let settleTimer = 0
    const readingTask = activityKey
    // A different selected control is a new action, even when an older control
    // is revisited. Geometry resolving the same fallback is still one task.
    for (const previous of manualReadingTasks.current) {
      if (previous.startsWith(`${tutorialStep}:`) && previous !== readingTask) manualReadingTasks.current.delete(previous)
    }
    let preserveReading = manualReadingTasks.current.has(readingTask)
    let userScrolled = false
    let layoutWritten = false
    const query = (selector: string) => document.querySelector<HTMLElement>(selector)
    const viewport = () => ({
      top: window.visualViewport?.offsetTop ?? 0,
      bottom: (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? innerHeight),
      left: window.visualViewport?.offsetLeft ?? 0,
      right: (window.visualViewport?.offsetLeft ?? 0) + (window.visualViewport?.width ?? innerWidth),
    })
    const setStyle = (name: string, value: string) => {
      if (root.style.getPropertyValue(name) !== value) {
        root.style.setProperty(name, value)
        layoutWritten = true
      }
    }
    const blockers = (target: HTMLElement) => {
      const nodes = [query('[data-tutorial-board] > header'), query('[data-testid="floater"]'), query('[data-tutorial-action-container]')]
      return nodes.filter((node): node is HTMLElement => !!node && !node.contains(target) && !target.contains(node)
        && ['fixed', 'sticky'].includes(getComputedStyle(node).position))
        .map((node) => node.getBoundingClientRect())
    }
    // One owner measures the primary spotlight and reversible secondary controls.
    // The SVG uses document coordinates so native scrolling cannot outrun its holes.
    const updateAllowedInteractions = () => {
      const svg = svgRef.current
      const matrix = svg?.getScreenCTM()
      if (!svg || !matrix) return
      const inverse = matrix.inverse()
      const controls: HTMLElement[] = []
      if (journalEntryAllowed) {
        const entry = query('[data-testid="tutorial-research-trigger"]')
        if (entry) controls.push(entry)
      }
      if (tutorialStep === 'round-1-thesis') {
        controls.push(...document.querySelectorAll<HTMLElement>('[data-tutorial-board] [data-tutorial-thesis] select, [data-tutorial-board] [data-tutorial-action-container] button'))
      }
      const rectangle = (rect: { left: number; top: number; right: number; bottom: number }) => {
        const points = [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]
          .map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse))
        return `M${points.map((point) => `${point.x} ${point.y}`).join('L')}Z`
      }
      const holes: string[] = []
      for (const control of controls) {
        if (control.closest('[aria-hidden="true"], [inert]') || control.matches(':disabled')) continue
        const bounds = control.getBoundingClientRect()
        // Keep the full document-space hole when a native click scrolls a
        // secondary control into view before the scroll listener refreshes it.
        const visible = { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }
        for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          const rect = parent.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            visible.left = Math.max(visible.left, rect.left + parent.clientLeft)
            visible.right = Math.min(visible.right, rect.left + parent.clientLeft + parent.clientWidth)
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            visible.top = Math.max(visible.top, rect.top + parent.clientTop)
            visible.bottom = Math.min(visible.bottom, rect.top + parent.clientTop + parent.clientHeight)
          }
        }
        if (visible.right <= visible.left || visible.bottom <= visible.top) continue
        const vp = viewport()
        const onScreen = { left: Math.max(visible.left, vp.left), right: Math.min(visible.right, vp.right),
          top: Math.max(visible.top, vp.top), bottom: Math.min(visible.bottom, vp.bottom) }
        if (onScreen.right > onScreen.left && onScreen.bottom > onScreen.top) {
          const hit = document.elementsFromPoint((onScreen.left + onScreen.right) / 2, (onScreen.top + onScreen.bottom) / 2)
            .find((element) => !element.closest('[data-tutorial-overlay]'))
          if (!hit || !control.contains(hit)) continue
        }
        holes.push(rectangle(visible))
      }
      const primary = query(spotlightSelector)
      const bounds = primary?.getBoundingClientRect()
      if (!bounds || bounds.width <= 0 || bounds.height <= 0 || primary?.closest('[aria-hidden="true"], [inert]')) return
      const topLeft = new DOMPoint(bounds.left - 8, bounds.top - 8).matrixTransform(inverse)
      const bottomRight = new DOMPoint(bounds.right + 8, bounds.bottom + 8).matrixTransform(inverse)
      const left = topLeft.x, top = topLeft.y, right = bottomRight.x, bottom = bottomRight.y
      const radius = Math.min(10, (right - left) / 2, (bottom - top) / 2)
      const spotlight = `M${left + radius} ${top}H${right - radius}Q${right} ${top} ${right} ${top + radius}V${bottom - radius}Q${right} ${bottom} ${right - radius} ${bottom}H${left + radius}Q${left} ${bottom} ${left} ${bottom - radius}V${top + radius}Q${left} ${top} ${left + radius} ${top}Z`
      // Measure the board rather than the previous mask, which must never
      // keep an obsolete document height alive after a shorter step.
      const boardBounds = query('[data-tutorial-board]')?.getBoundingClientRect()
      const width = Math.max(root.clientWidth, (boardBounds?.right ?? 0) + window.scrollX)
      const height = Math.max(root.clientHeight, (boardBounds?.bottom ?? 0) + window.scrollY)
      const frame = `M0 0H${width}V${height}H0Z`
      const next = { identity, width, height, frame, spotlight, secondary: frame + holes.join('') }
      setMask((current) => current && JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }

    const position = () => {
      frame = 0
      layoutWritten = false
      let target = query(anchorSelector)
      const coach = query('[data-testid="floater"]')
      if (!target || !coach) return
      const header = query('[data-tutorial-board] > header')
      const action = query('[data-tutorial-action-container]')
      const vp = viewport()
      const coachHeight = coach.getBoundingClientRect().height
      const headerHeight = header?.getBoundingClientRect().height ?? 0
      const actionHeight = action?.getBoundingClientRect().height ?? 0
      const available = tutorialSafeVerticalBounds({ viewport: vp, target: target.getBoundingClientRect(), blockers: blockers(target) })
      const fallback = fallbackSelector && query(fallbackSelector)
      // Our own fixed/static layout changes can temporarily move blockers out
      // of view. Keep the compact reading budget independent of that movement,
      // so a later positioning pass cannot replace a pressed control with its form.
      const availableHeight = compactLayout && !target.closest('[role="dialog"]')
        ? vp.bottom - vp.top - coachHeight - headerHeight - actionHeight - 48
        : available.bottom - available.top
      const useFallback = !!fallback && target.getBoundingClientRect().height > availableHeight
      if (useFallback) target = fallback
      const targetHeight = target.getBoundingClientRect().height
      // Native focus/click scrolling also needs the occupied space on desktop.
      // Feedback can grow the coach beyond the default scroll-padding budget.
      setStyle('--tutorial-pilot-coach-height', `${coachHeight}px`)
      setStyle('--tutorial-pilot-header-height', `${headerHeight}px`)
      if (compactLayout) {
        const actionInFlow = !action?.contains(target)
          && vp.bottom - vp.top - coachHeight - headerHeight - actionHeight - 48 < targetHeight
        const constrained = vp.bottom - vp.top - coachHeight - headerHeight - 48 < targetHeight
        if (root.hasAttribute('data-tutorial-pilot-constrained') !== constrained) {
          root.toggleAttribute('data-tutorial-pilot-constrained', constrained)
          layoutWritten = true
        }
        setStyle('--tutorial-pilot-action-height', `${actionInFlow ? 0 : actionHeight}px`)
        setStyle('--tutorial-pilot-action-position', actionInFlow ? 'static' : 'fixed')
        setStyle('--tutorial-mobile-action-height', `${actionInFlow ? 0 : actionHeight}px`)
        setStyle('--tutorial-mobile-action-position', actionInFlow ? 'static' : 'fixed')
        setStyle('--tutorial-mobile-coach-bottom', `${coach.getBoundingClientRect().bottom}px`)
      }
      // A coach resize can move the fixed command without resizing it. Read
      // that new position only after the CSS variable update has committed.
      if (layoutWritten) {
        schedule()
        return
      }
      onTargetResolved(anchorSelector, useFallback ? fallbackSelector! : anchorSelector)
      if (!userScrolled && getComputedStyle(target).position !== 'fixed') {
        // Scroll the nearest actual scroll area first, then its ancestors. A
        // modal's independently scrollable panel never scrolls the document.
        for (const nestedTarget of [target, secondarySelector ? query(secondarySelector) : null]) {
          if (!nestedTarget) continue
          let parent = nestedTarget.parentElement
          while (parent && parent !== document.body) {
            const style = getComputedStyle(parent)
            if (/(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) {
              const bounds = parent.getBoundingClientRect()
              const rect = nestedTarget.getBoundingClientRect()
              parent.scrollLeft += tutorialScrollDelta({ top: rect.left, bottom: rect.right }, { top: bounds.left + 4, bottom: bounds.right - 4 })
            }
            if (!preserveReading && /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
              const bounds = parent.getBoundingClientRect()
              parent.scrollTop += tutorialScrollDelta(nestedTarget.getBoundingClientRect(), { top: bounds.top + 8, bottom: bounds.bottom - 8 })
            }
            if (parent.matches('[role="dialog"]')) break
            parent = parent.parentElement
          }
        }
        // Journal returns focus without scrolling. Keep that reversible control
        // visible when its modal closes, rather than repositioning the Thesis.
        const focusedEntry = restoreJournalFocus ? query('[data-testid="tutorial-research-trigger"]') : null
        const scrollTarget = focusedEntry === document.activeElement ? focusedEntry : target
        if (scrollTarget && (!preserveReading || scrollTarget === focusedEntry) && !scrollTarget.closest('[role="dialog"]')) {
          const bounds = tutorialSafeVerticalBounds({ viewport: vp, target: scrollTarget.getBoundingClientRect(), blockers: blockers(scrollTarget) })
          const delta = tutorialScrollDelta(scrollTarget.getBoundingClientRect(), bounds)
          if (Math.abs(delta) > 1 && scrollTarget.getBoundingClientRect().height <= bounds.bottom - bounds.top) {
            window.scrollBy({ top: delta, behavior: 'instant' })
          }
        }
      }
      updateAllowedInteractions()
      delete root.dataset.tutorialAutoscrolling
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(position) }
    const focusChanged = (event: FocusEvent) => {
      if (restoreJournalFocus && event.target instanceof Element && event.target.matches('[data-testid="tutorial-research-trigger"]')) schedule()
    }
    const layoutChanged = () => {
      userScrolled = false
      preserveReading = false
      manualReadingTasks.current.delete(readingTask)
      schedule()
    }
    const cancel = (event: Event) => {
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
      if (event instanceof PointerEvent && event.target instanceof Element
        && event.target.closest('button, input, select, textarea, a, summary, [role="tab"]')) return
      userScrolled = true
      // Real reading gestures survive a same-task modal pause, including a
      // coach remount. The next selected control or lesson gets its own key.
      if (!(event instanceof PointerEvent) || query(anchorSelector)?.closest('[role="dialog"]')) {
        manualReadingTasks.current.add(readingTask)
      }
      clearTimeout(settleTimer)
    }
    // Ignore observer notifications with unchanged sizes; scrolling is never a
    // reason to bring the player back to the target.
    const sizes = new WeakMap<Element, string>()
    const observer = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const size = `${entry.contentRect.width}:${entry.contentRect.height}`
        if (sizes.get(entry.target) !== size) { sizes.set(entry.target, size); changed = true }
      }
      if (changed && !userScrolled) schedule()
    })
    const observe = () => {
      for (const node of [query(anchorSelector), query('[data-testid="floater"]'), query('[data-tutorial-board] > header'), query('[data-tutorial-action-container]')]) if (node) observer.observe(node)
      schedule()
    }
    const mutations = new MutationObserver((records) => {
      // Updating our SVG interaction cutout is not a new reading task. In
      // particular it must never pull a manually revealed control out of view.
      const changed = records.some((record) => {
        if (record.target instanceof Element && record.target.closest('[data-tutorial-overlay]')) return false
        return [...record.addedNodes, ...record.removedNodes].some((node) =>
          !(node instanceof Element && node.matches('[data-tutorial-overlay]')))
      })
      if (changed) observe()
    })
    mutations.observe(document.body, { childList: true, subtree: true })
    for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(event, cancel, { passive: true })
    window.addEventListener('focusin', focusChanged)
    window.addEventListener('resize', layoutChanged)
    window.visualViewport?.addEventListener('resize', layoutChanged)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.addEventListener('scroll', updateAllowedInteractions, { passive: true, capture: true })
    observe()
    settleTimer = window.setTimeout(schedule, 160)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settleTimer)
      observer.disconnect()
      mutations.disconnect()
      for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.removeEventListener(event, cancel)
      window.removeEventListener('focusin', focusChanged)
      window.removeEventListener('resize', layoutChanged)
      window.visualViewport?.removeEventListener('resize', layoutChanged)
      window.visualViewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', updateAllowedInteractions, true)
      for (const name of ['--tutorial-pilot-action-height', '--tutorial-pilot-action-position', '--tutorial-mobile-action-height', '--tutorial-mobile-action-position', '--tutorial-mobile-coach-bottom']) root.style.removeProperty(name)
      root.removeAttribute('data-tutorial-pilot-constrained')
      delete root.dataset.tutorialAutoscrolling
    }
  }, [tutorialStep, activityKey, restoreJournalFocus, manualReadingTasks, anchorSelector, secondarySelector, fallbackSelector, onTargetResolved, compactLayout, journalEntryAllowed, spotlightSelector, identity])
  return children ? createPortal(<>
    <div data-testid="overlay" data-tutorial-overlay="" className={styles.coachOverlay}
      style={{ height: visibleMask?.height ?? 0, visibility: visibleMask ? 'visible' : 'hidden' }} aria-hidden="true">
      <svg ref={svgRef} width={visibleMask?.width ?? window.innerWidth} height={visibleMask?.height ?? window.innerHeight}>
        <defs>
          <clipPath id="tutorial-allowed-controls" clipPathUnits="userSpaceOnUse">
            <path d={visibleMask?.secondary ?? ''} clipRule="evenodd" />
          </clipPath>
        </defs>
        <g clipPath="url(#tutorial-allowed-controls)">
          <path d={(visibleMask?.frame ?? '') + (visibleMask?.spotlight ?? '')} fill="rgba(0, 5, 12, .38)" fillRule="evenodd" pointerEvents="none" />
          <path d={(visibleMask?.frame ?? '') + (blockTargetInteraction ? '' : visibleMask?.spotlight ?? '')} fill="transparent" fillRule="evenodd" pointerEvents="fill" />
        </g>
        <g data-tutorial-spotlight="" pointerEvents="none">
          <path d={visibleMask?.spotlight ?? ''} fill="none" stroke={showSpotlightStroke ? '#38bdf8' : 'none'} strokeWidth={3} />
        </g>
      </svg>
    </div>
    <div data-testid="floater" style={{ opacity: visibleMask ? 1 : 0, pointerEvents: visibleMask ? 'auto' : 'none' }}>{children}</div>
  </>, document.body) : null
}

function CoachContent({
  onExit,
  exitButtonRef,
  onContinue,
  onBack,
  canGoBack,
  onReset,
  task,
  pilot,
  thesisFeedback,
  progress,
}: {
  onExit: (event: MouseEvent<HTMLButtonElement>) => void
  exitButtonRef: (button: HTMLButtonElement | null) => void
  onContinue?: () => void
  onBack: () => void
  canGoBack: boolean
  onReset?: () => void
  task: string
  pilot?: { action: string; why: string; expanded: boolean; onToggle: () => void }
  thesisFeedback: NonNullable<TutorialAdvanceResult['thesisFeedback']> | null
  progress: string
}) {
  const { t } = useI18n()
  return (
    <div className={styles.coach} onFocus={(event) => {
      const control = event.target
      if (!(control instanceof HTMLElement) || !control.matches('button:focus-visible')) return
      const reading = event.currentTarget.closest<HTMLElement>('[data-tutorial-step]')
      if (!reading) return
      const viewport = reading.getBoundingClientRect()
      const target = control.getBoundingClientRect()
      const top = viewport.top + reading.clientTop + 4
      const bottom = viewport.top + reading.clientTop + reading.clientHeight - 4
      // Enlarged coach actions can wrap onto several rows. Native keyboard
      // focus must reveal its own control without moving the lesson document.
      if (target.top < top) reading.scrollTop += target.top - top
      else if (target.bottom > bottom) reading.scrollTop += target.bottom - bottom
    }}>
      <Typography variant="caption" tone="muted">{progress}</Typography>
      {pilot ? <>
        <Typography id="tutorial-coach-title" as="strong" variant="bodySmMedium">{pilot.action}</Typography>
        <Typography variant="bodySm" tone="muted">{pilot.why}</Typography>
        <div id="tutorial-coach-explanation" role="region" hidden={!pilot.expanded} aria-label={t('tutorial.pilot.explanation')}>
          <Typography variant="bodySm">{task}</Typography>
        </div>
      </> : <>
        <Typography id="tutorial-coach-title" as="strong" variant="bodySmMedium">{t('tutorial.coach.task')}</Typography>
        <Typography variant="bodySm">{task}</Typography>
      </>}
      {thesisFeedback && (
        <Typography role="alert" variant="bodySm" className={styles.thesisFeedback}>
          {t(thesisFeedback.fieldTypeCorrect ? 'tutorial.base.fieldCorrect' : 'tutorial.coach.thesisFieldIncorrect')} {t(thesisFeedback.polarityCorrect ? 'tutorial.base.polarityCorrect' : 'tutorial.coach.thesisPolarityIncorrect')}
        </Typography>
      )}
      {onReset && <Typography role="status" variant="bodySm">{t('tutorial.base.exhausted')}</Typography>}
      {!pilot && <Typography as="strong" variant="bodySmMedium" className={styles.confirmAction}>
        {t('tutorial.coach.confirmAction')}
      </Typography>}
      <div className={styles.coachActions}>
        {pilot && <Button type="button" variant="ghost" size="sm"
          aria-expanded={pilot.expanded} aria-controls="tutorial-coach-explanation" onClick={pilot.onToggle}>
          {t('tutorial.pilot.more')}
        </Button>}
        <Button type="button" size="sm" variant="outline" data-tutorial-back disabled={!canGoBack} onClick={onBack}>{t('tutorial.back')}</Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('tutorial.exit')}
          ref={exitButtonRef}
          onClick={onExit}
        >
          {t('tutorial.exit.short')}
        </Button>
        {onReset && <Button type="button" size="sm" onClick={onReset}>{t('tutorial.base.retry')}</Button>}
        {onContinue && <Button type="button" size="sm" onClick={onContinue}>{t('tutorial.coach.continue')}</Button>}
      </div>
    </div>
  )
}

