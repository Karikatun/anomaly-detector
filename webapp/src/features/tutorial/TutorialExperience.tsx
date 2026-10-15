import { Joyride, type Step, type TooltipRenderProps } from 'react-joyride'
import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'

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
import { productAnalytics } from '@/platform/analytics/product-analytics'
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
import {
  clearTutorialSession,
  saveTutorialSession,
} from './session'
import { resolveTutorialPresentation, tutorialSafeVerticalBounds, tutorialScrollDelta } from './tutorial-layout'
import styles from './TutorialPage.module.css'

const taskKeys: Record<Exclude<TutorialStep, 'complete' | 'prologue'>, TranslationKey> = {
  'interaction-guide': 'tutorial.step.interactionGuide',
  'round-1-header': 'tutorial.step.round1Header',
  'round-1-sidebar': 'tutorial.step.round1Sidebar',
  'round-1-contracts': 'tutorial.step.round1Contracts',
  'round-1-access-intro': 'tutorial.step.round1AccessIntro',
  'round-1-access': 'tutorial.step.round1Access',
  'round-1-power-intro': 'tutorial.step.round1PowerIntro',
  'round-1-power': 'tutorial.step.round1Power',
  'round-1-recon-intro': 'tutorial.step.round1ReconIntro',
  'round-1-recon': 'tutorial.step.round1Recon',
  'round-1-lab-intro': 'tutorial.step.round1LabIntro',
  'round-1-lab-mode': 'tutorial.step.round1LabMode',
  'round-1-lab-pair': 'tutorial.step.round1LabPair',
  'research-results': 'tutorial.step.researchResults',
  'research-results-open': 'tutorial.step.researchResultsOpen',
  'help-menu': 'tutorial.step.help',
  interpretation: 'tutorial.step.interpretation',
  'interpretation-open': 'tutorial.step.interpretationOpen',
  'round-1-model-intro': 'tutorial.step.round1ModelIntro',
  'round-1-working-model': 'tutorial.step.round1Model',
  'round-1-thesis': 'tutorial.step.round1Thesis',
  'round-1-thesis-result': 'tutorial.step.round1ThesisResult',
  'round-1-thesis-result-open': 'tutorial.step.round1ThesisResultOpen',
  'round-2-access': 'tutorial.step.round2Access',
  'round-2-contracts-review': 'tutorial.step.round2ContractsReview',
  'round-2-contracts-review-open': 'tutorial.step.round2ContractsReviewOpen',
  'round-2-power': 'tutorial.step.round2Power',
  'round-2-recon': 'tutorial.step.round2Recon',
  'round-2-lab': 'tutorial.step.round2Lab',
  'round-2-research': 'tutorial.step.round2Research',
  'round-2-research-open': 'tutorial.step.round2ResearchOpen',
  'round-2-working-model': 'tutorial.step.round2Model',
  'round-2-thesis': 'tutorial.step.round2Thesis',
  'round-2-contracts-intro': 'tutorial.step.contractsIntro',
  'round-2-contract-reserve': 'tutorial.step.contractReserve',
  'round-2-contract-bid': 'tutorial.step.contractBid',
  'final-model-intro': 'tutorial.step.finalModelIntro',
  'final-model': 'tutorial.step.finalModel',
}

const mobileTaskKeys: Partial<Record<Exclude<TutorialStep, 'complete' | 'prologue'>, TranslationKey>> = {
  'round-1-header': 'tutorial.step.round1HeaderMobile',
  'round-1-sidebar': 'tutorial.step.round1SidebarMobile',
  'round-1-contracts': 'tutorial.step.round1ContractsMobile',
  'research-results': 'tutorial.step.researchResultsMobile',
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

const orderedSteps = Object.keys(taskKeys) as Array<Exclude<TutorialStep, 'complete' | 'prologue'>>
const informationalSteps = new Set<TutorialStep>([
  'interaction-guide',
  'round-1-header',
  'round-1-sidebar',
  'round-1-contracts',
  'round-1-access-intro',
  'round-1-power-intro',
  'round-1-recon-intro',
  'round-1-lab-intro',
  'round-1-model-intro',
  'round-2-contracts-intro',
  'final-model-intro',
])
const mobileActionPinnedSteps = new Set<TutorialStep>([
  'round-1-access-intro',
  'round-1-access',
  'round-1-power',
  'round-1-recon',
  'round-1-lab-pair',
  'round-1-thesis',
  'round-2-access',
  'round-2-power',
  'round-2-recon',
  'round-2-lab',
  'round-2-thesis',
])

export function TutorialExperience({
  initialState,
  onComplete,
  onExit,
  exitLabel,
  renderCompletion,
}: {
  initialState: TutorialState
  onComplete?: () => Promise<void>
  onExit: () => void
  exitLabel: TranslationKey
  renderCompletion: (restart: () => void) => ReactNode
}) {
  const { t } = useI18n()
  const [state, setState] = useState(initialState)
  const [lesson, setLesson] = useState(() => new AbortController())
  const playerId = initialState.playerId
  const [commandError, setCommandError] = useState<string | null>(null)
  const [thesisFeedback, setThesisFeedback] = useState<NonNullable<TutorialAdvanceResult['thesisFeedback']> | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  const [explanationStep, setExplanationStep] = useState<TutorialStep | null>(null)
  const [requiredModalOpen, setRequiredModalOpen] = useState(false)
  const [journalOpen, setJournalOpen] = useState(false)
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



  const applyAction = async (action: TutorialAction) => {
    // Disposal may flush a draft through an old callback after Exit or Repeat.
    // Only callbacks belonging to the active lesson may persist or progress it.
    if (lesson.signal.aborted) return false
    const result = advanceTutorial(state, action)
    setThesisFeedback(action.type === 'submit-thesis' && result.thesisFeedback && !result.progressed
      ? result.thesisFeedback
      : null)
    const stateChanged = result.state !== state
    if (stateChanged) {
      if (result.state.step !== state.step) setExplanationStep(null)
      setState(result.state)
      saveTutorialSession(sessionStorage, result.state)
    }
    const isDraftSave = action.type === 'update-scientific-model-draft' || action.type === 'update-working-model'
    const isNavigation = action.type.startsWith('open-') || action.type.startsWith('close-')
    const isThesisAttempt = action.type === 'submit-thesis' && result.thesisFeedback !== undefined
    setCommandError(result.progressed || isDraftSave || isThesisAttempt || isNavigation
      ? null
      : t(state.step === 'round-1-power'
        ? 'tutorial.coach.powerRound1Invalid'
        : state.step === 'round-2-power'
          ? 'tutorial.coach.powerRound2Invalid'
          : state.step === 'round-2-working-model'
            ? 'tutorial.coach.modelCheck'
            : 'tutorial.coach.invalid'))

    if (result.state.step === 'complete' && state.step !== 'complete') {
      void productAnalytics.record('tutorial_complete')
      await onComplete?.()
    }

    return result.progressed
  }

  const restart = () => {
    lesson.abort()
    setLesson(new AbortController())
    clearTutorialSession(sessionStorage, playerId)
    const fresh = createTutorialState(playerId)
    saveTutorialSession(sessionStorage, fresh)
    setCommandError(null)
    setThesisFeedback(null)
    setExplanationStep(null)
    setState(fresh)
  }

  const exit = () => {
    lesson.abort()
    clearTutorialSession(sessionStorage, playerId)
    setExitOpen(false)
    onExit()
  }

  if (state.step === 'prologue') {
    return (
      <section className={styles.statePage}>
        <ExpeditionBackground />
        <Dialog open>
          <DialogContent
            showCloseButton={false}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>{t('tutorial.prologue.title')}</DialogTitle>
              <DialogDescription>{t('tutorial.prologue.description')}</DialogDescription>
            </DialogHeader>
            <div className={styles.stateContent}>
              <Typography>{t('tutorial.prologue.mission')}</Typography>
              <Typography tone="muted">{t('tutorial.prologue.goal')}</Typography>
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

  if (state.step === 'complete') return renderCompletion(restart)

  const retiredSteps = new Set<TutorialStep>([
    'interaction-guide', 'round-1-header', 'round-1-sidebar', 'round-1-contracts',
    'round-1-access-intro', 'round-1-power-intro', 'round-1-recon-intro', 'round-1-lab-intro',
    'help-menu', 'round-1-model-intro', 'round-1-thesis-result',
    'round-1-thesis-result-open', 'round-2-contracts-intro', 'final-model-intro',
  ])
  const visibleSteps = orderedSteps.filter((tutorialStep) => !retiredSteps.has(tutorialStep))
  const currentTaskKey: TranslationKey = (compactHeader ? mobileTaskKeys[state.step] : undefined) ?? taskKeys[state.step]
  const phaseTargetConfig: Record<Exclude<TutorialStep, 'complete' | 'prologue'>, {
    anchor: string
    spotlight?: string
    secondary?: string
  }> = {
    'interaction-guide': { anchor: '[data-tutorial-access-intro]' },
    'round-1-header': { anchor: '[data-tutorial-highlight="header"] > header' },
    'round-1-sidebar': { anchor: '[data-tutorial-sidebar]' },
    'round-1-contracts': { anchor: '[data-tutorial-contracts]' },
    'round-1-access-intro': {
      anchor: '[data-tutorial-access-slot="1"]',
      spotlight: '[data-tutorial-access-options]',
    },
    'round-1-access': {
      anchor: '[data-tutorial-access-slot="5"]',
    },
    'round-1-power-intro': {
      anchor: compactGuidance ? '[data-tutorial-power-intro]' : '[data-tutorial-primary]',
    },
    'round-1-power': {
      anchor: '[data-tutorial-power-category="reconnaissance"]',
      spotlight: '[data-tutorial-power-options]',
    },
    'round-1-recon-intro': { anchor: '[data-tutorial-primary]' },
    'round-1-recon': {
      anchor: '[data-tutorial-recon-anchor]',
      spotlight: '[data-tutorial-recon-options]',
    },
    'round-1-lab-intro': { anchor: '[data-tutorial-primary]' },
    'round-1-lab-mode': {
      anchor: '[data-tutorial-lab-modes]',
    },
    'round-1-lab-pair': {
      anchor: '[data-tutorial-lab-sample="aster"]',
      spotlight: '[data-tutorial-lab-pair]',
    },
    'research-results': { anchor: '[data-testid="tutorial-research-trigger"]' },
    'research-results-open': {
      anchor: '[data-tender-journal] [data-research-experiment]:first-child > p:first-of-type',
      secondary: '[data-tutorial-journal-tab="interpretation"]',
    },
    'help-menu': {
      anchor: compactHeader ? '[data-tutorial-help]' : '[data-tutorial-interpretation-direct]',
    },
    interpretation: { anchor: '[data-testid="tutorial-research-trigger"]' },
    'interpretation-open': {
      anchor: '[data-tutorial-journal-tab="working-model"]',
    },
    'round-1-model-intro': { anchor: '[data-tutorial-primary]' },
    'round-1-working-model': {
      anchor: journalOpen
        ? '[data-tender-journal]'
        : '[data-testid="tutorial-research-trigger"]',
    },
    'round-1-thesis': {
      anchor: '[data-tutorial-thesis]',
      spotlight: '[data-tutorial-thesis]',
    },
    'round-1-thesis-result': { anchor: '[data-testid="tutorial-research-trigger"]' },
    'round-1-thesis-result-open': { anchor: '[data-tender-journal]' },
    'round-2-access': {
      anchor: '[data-tutorial-access-slot="4"]',
      spotlight: '[data-tutorial-access-options]',
    },
    'round-2-contracts-review': { anchor: '[data-testid="tutorial-contracts-trigger"]' },
    'round-2-contracts-review-open': { anchor: '[data-testid="tutorial-contracts-dialog"]' },
    'round-2-power': {
      anchor: '[data-tutorial-power-category="reconnaissance"]',
      spotlight: '[data-tutorial-power-options]',
    },
    'round-2-recon': {
      anchor: '[data-tutorial-recon-anchor]',
      spotlight: '[data-tutorial-recon-options]',
    },
    'round-2-lab': {
      anchor: '[data-tutorial-lab-sample="boreal"]',
      spotlight: '[data-tutorial-lab-options]',
    },
    'round-2-research': { anchor: '[data-testid="tutorial-research-trigger"]' },
    'round-2-research-open': {
      anchor: '[data-tender-journal] [data-research-experiment]:first-child > p:first-of-type',
      secondary: '[data-tutorial-journal-tab="working-model"]',
    },
    'round-2-working-model': {
      anchor: journalOpen
        ? '[data-tender-journal]'
        : '[data-testid="tutorial-research-trigger"]',
    },
    'round-2-thesis': {
      anchor: '[data-tutorial-thesis] select',
      spotlight: '[data-tutorial-thesis]',
    },
    'round-2-contracts-intro': { anchor: '[data-tutorial-primary]' },
    'round-2-contract-reserve': {
      anchor: '[data-contract-id="tutorial-light-contract"]',
    },
    'round-2-contract-bid': {
      anchor: '[data-contract-id="tutorial-light-contract"]',
    },
    'final-model-intro': { anchor: '[data-tutorial-primary]' },
    'final-model': {
      anchor: '[data-tutorial-final-submit]',
    },
  }
  const pilot = pilotCopy[state.step]
  const requestedTarget = nearest?.selector ? { anchor: nearest.selector } : phaseTargetConfig[state.step]
  const targetConfig = resolvedTarget?.requested === requestedTarget.anchor
    && resolvedTarget.selector !== requestedTarget.anchor
    ? { anchor: resolvedTarget.selector } : requestedTarget
  const readingDialogOpen = journalOpen || state.step === 'round-2-contracts-review-open'
  const presentation = resolveTutorialPresentation({
    anchor: targetConfig.anchor,
    compactGuidance,
    compactHeader,
    spotlight: targetConfig.spotlight,
    step: state.step,
  })
  const highlight = state.step === 'round-1-header'
    ? 'header' as const
    : state.step === 'round-1-sidebar'
      ? 'sidebar' as const
      : state.step === 'round-1-contracts'
        ? 'contracts' as const
        : state.step === 'round-2-contracts-review' || state.step === 'round-2-contracts-review-open'
          ? 'contracts' as const
          : state.step === 'research-results'
              || state.step === 'research-results-open'
              || state.step === 'round-1-thesis-result'
              || state.step === 'round-1-thesis-result-open'
              || state.step === 'round-2-research' || state.step === 'round-2-research-open'
          ? 'research' as const
          : state.step === 'help-menu'
    ? 'help' as const
    : state.step === 'interpretation' || state.step === 'interpretation-open'
      ? 'interpretation' as const
      : state.step === 'round-1-working-model' || state.step === 'round-2-working-model'
        ? 'working-model' as const
        : 'primary' as const
  const step: Step = {
    content: (
      <CoachContent
        progress={state.step === 'interaction-guide'
          ? t('tutorial.coach.beforeStart')
          : t('tutorial.coach.progress', {
            current: visibleSteps.indexOf(state.step) + 1,
            total: visibleSteps.length,
          })}
        hint={state.hintLevel > 0 ? t('tutorial.coach.hint') : undefined}
        onContinue={informationalSteps.has(state.step)
          ? () => void applyAction({ type: 'continue' })
          : undefined}
        onExit={() => setExitOpen(true)}
        pilot={pilot ? {
          action: t(nearest?.action ?? pilot.action, nearest?.values),
          why: t(pilot.why),
          expanded: explanationStep === state.step,
          onToggle: () => setExplanationStep(explanationStep === state.step ? null : state.step),
        } : undefined}
        task={t(currentTaskKey)}
        thesisFeedback={thesisFeedback}
      />
    ),
    data: { tutorialStep: state.step, pilot: Boolean(pilot) },
    hideOverlay: presentation.hideOverlay,
    placement: 'auto',
    scrollOffset: 20,
    scrollTarget: presentation.positionTarget,
    skipScroll: true,
    spotlightTarget: presentation.spotlightTarget,
    target: targetConfig.anchor,
  }

  const journalGuidanceOpen = journalOpen

  return (
    <>
      {!exitOpen && !requiredModalOpen && (
        <TutorialViewportAnchor
          taskKey={state.step}
          manualReadingTasks={manualReadingTasks}
          anchorSelector={requestedTarget.anchor}
          secondarySelector={requestedTarget.secondary}
          fallbackSelector={nearest?.fallbackSelector}
          onTargetResolved={resolveTarget}
          compactLayout={compactHeader}
          journalEntryAllowed={!informationalSteps.has(state.step)}
        />
      )}
      {!exitOpen && !requiredModalOpen && !journalGuidanceOpen && <Joyride
        key={`${state.step}:${targetConfig.anchor}`}
        locale={{
          back: t('tutorial.joyride.back'),
          close: t('tutorial.joyride.close'),
          last: t('tutorial.joyride.last'),
          next: t('tutorial.joyride.next'),
          nextWithProgress: t('tutorial.joyride.nextWithProgress'),
          open: t('tutorial.joyride.open'),
          skip: t('tutorial.joyride.skip'),
        }}
        run
        steps={[step]}
        tooltipComponent={TutorialTooltip}
        options={{
          arrowColor: 'var(--card)',
          arrowSize: 0,
          blockTargetInteraction: informationalSteps.has(state.step),
          buttons: [],
          disableFocusTrap: true,
          dismissKeyAction: false,
          overlayClickAction: false,
          overlayColor: 'rgba(0, 5, 12, .38)',
          primaryColor: '#38bdf8',
          showProgress: false,
          skipBeacon: true,
          spotlightPadding: 8,
          spotlightRadius: 10,
          targetWaitTimeout: 3000,
          textColor: '#e8f4ff',
          backgroundColor: 'var(--card)',
          zIndex: 100,
        }}
        styles={{
          spotlight: readingDialogOpen
            ? {}
            : { stroke: '#38bdf8', strokeWidth: 3 },
        }}
      />}
      <Typography aria-live="polite" variant="srOnly">{pilot ? `${t(nearest?.action ?? pilot.action, nearest?.values)} ${t(pilot.why)}` : t(currentTaskKey)}</Typography>
      <TutorialTenderBoard
        key={state.playerId}
        journalGuidance={journalGuidanceOpen && !exitOpen && !requiredModalOpen ? (
          <Card className={`${styles.coachCard} ${styles.journalCoach}`} data-testid="floater"
            data-tutorial-step={state.step} data-tutorial-pilot={Boolean(pilot) || undefined} size="sm" aria-labelledby="tutorial-coach-title">
            <CardContent>{step.content}</CardContent>
          </Card>
        ) : undefined}
        actionPanelPinned={mobileActionPinnedSteps.has(state.step)}
        commandError={commandError}
        highlight={exitOpen ? 'none' : highlight}
        interpretationRequired={state.step === 'help-menu'
          || state.step === 'interpretation'
          || state.step === 'interpretation-open'
          || state.step === 'round-1-thesis-result'
          || state.step === 'round-1-thesis-result-open'
          || state.step === 'round-2-contracts-review'
          || state.step === 'round-2-contracts-review-open'}
        laboratoryInitialMode={state.step === 'round-1-lab-pair' ? 'deep' : undefined}
        onCommand={async (command: TenderCommandInput) => {
          await applyAction(command)
        }}
        onExitRequest={() => setExitOpen(true)}
        onHelpMenuOpened={() => void applyAction({ type: 'open-help-menu' })}
        onDirectInterpretationOpened={() => void applyAction({ type: 'open-interpretation-direct' })}
        onContractsClosed={() => void applyAction({ type: 'close-contracts-review' })}
        onContractsOpened={() => void applyAction({ type: 'open-contracts-review' })}
        onInterpretationOpened={() => void applyAction({ type: 'open-interpretation' })}
        onLaboratoryModeSelected={(mode) => void applyAction({ type: 'select-laboratory-mode', mode })}
        onJournalClosed={(workingModel) => void applyAction({ type: 'close-journal', workingModel })}
        onJournalOpenChange={setJournalOpen}
        onWorkingModelOpened={() => void applyAction({ type: 'open-working-model' })}
        onResearchOpened={() => void applyAction({ type: 'open-research-results' })}
        onRequiredModalOpenChange={setRequiredModalOpen}
        onSaveWorkingModel={(workingModel) => applyAction({ type: 'update-working-model', workingModel })}
        view={tutorialView(state)}
      />
      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent className={styles.exitDialog}>
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
      if (step === 'round-1-access' || step === 'round-2-access') {
        const slot = step === 'round-1-access' ? 5 : 4
        return board.querySelector(`[data-tutorial-access-slot="${slot}"][aria-pressed="true"]`)
          ? { selector: confirm, action: 'tutorial.pilot.access.confirm' }
          : { selector: `[data-tutorial-access-slot="${slot}"]` }
      }
      if (step === 'round-1-power' || step === 'round-2-power') {
        const categories = ['reconnaissance', 'laboratory', 'modelAnalysis', 'contracts'] as const
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
        return { selector: confirm, action: 'tutorial.pilot.power.confirm' }
      }
      if (step === 'round-1-recon' || step === 'round-2-recon') {
        return board.querySelector(confirm)
          ? { selector: confirm, action: 'tutorial.pilot.recon.confirm' }
          : { selector: '[data-tutorial-recon-anchor]' }
      }
      if (step === 'round-1-lab-mode') return { selector: '[data-tutorial-lab-modes] button:first-child' }
      if (step === 'round-1-lab-pair') {
        const source = board.querySelector('[data-tutorial-lab-sample="aster"][data-role="source"]')
        const receiver = board.querySelector('[data-tutorial-lab-sample="boreal"][data-role="receiver"]')
        if (!source) return { selector: '[data-tutorial-lab-sample="aster"]', action: 'tutorial.pilot.pair.source' }
        if (!receiver) return { selector: '[data-tutorial-lab-sample="boreal"]', action: 'tutorial.pilot.pair.receiver' }
        return { selector: confirm, action: 'tutorial.pilot.pair.confirm' }
      }
      if (step === 'round-2-lab') {
        if (!board.querySelector('[data-tutorial-lab-sample="boreal"][data-role="source"]')) return { selector: '[data-tutorial-lab-sample="boreal"]' }
        if (!board.querySelector('[data-tutorial-lab-sample="cinder"][data-role="receiver"]')) return { selector: '[data-tutorial-lab-sample="cinder"]' }
        return { selector: confirm }
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
    sync()
    return () => observer.disconnect()
  }, [step])
  return selection?.step === step ? selection.action : null
}

function TutorialViewportAnchor({ taskKey, manualReadingTasks, anchorSelector, secondarySelector, fallbackSelector, onTargetResolved, compactLayout, journalEntryAllowed }: {
  taskKey: TutorialStep
  manualReadingTasks: RefObject<Set<string>>
  anchorSelector: string
  secondarySelector?: string
  fallbackSelector?: string
  onTargetResolved: (requested: string, selector: string) => void
  compactLayout: boolean
  journalEntryAllowed: boolean
}) {
  useLayoutEffect(() => {
    const root = document.documentElement
    let frame = 0
    let settleTimer = 0
    const readingTask = `${taskKey}:${anchorSelector}`
    const preserveReading = manualReadingTasks.current.has(readingTask)
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
    // The Journal is in normal flow during training. Keep the original Joyride
    // interaction gate and allow this explicit secondary entry when it is visible.
    const updateJournalInteraction = () => {
      const entry = query('[data-testid="tutorial-research-trigger"]')
      const svg = document.querySelector<SVGSVGElement>('.react-joyride__overlay svg')
      root.style.removeProperty('--tutorial-journal-entry-cutout')
      if (!journalEntryAllowed || !entry || !svg || entry.closest('[aria-hidden="true"], [inert]')) return
      const rect = entry.getBoundingClientRect()
      const hit = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        .find((element) => !element.closest('.react-joyride__overlay'))
      if (!hit || !entry.contains(hit)) return
      const overlay = svg.getBoundingClientRect()
      const left = rect.left - overlay.left, top = rect.top - overlay.top
      const path = `M0 0H${overlay.width}V${overlay.height}H0Z M${left} ${top}h${rect.width}v${rect.height}h-${rect.width}Z`
      root.style.setProperty('--tutorial-journal-entry-cutout', `path(evenodd, "${path}")`)
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
      const useFallback = !!fallback && target.getBoundingClientRect().height > available.bottom - available.top
      if (useFallback) target = fallback
      const targetHeight = target.getBoundingClientRect().height
      if (compactLayout) {
        const actionInFlow = !action?.contains(target)
          && vp.bottom - vp.top - coachHeight - headerHeight - actionHeight - 48 < targetHeight
        const constrained = vp.bottom - vp.top - coachHeight - headerHeight - 48 < targetHeight
        if (root.hasAttribute('data-tutorial-pilot-constrained') !== constrained) {
          root.toggleAttribute('data-tutorial-pilot-constrained', constrained)
          layoutWritten = true
        }
        setStyle('--tutorial-pilot-coach-height', `${coachHeight}px`)
        setStyle('--tutorial-pilot-header-height', `${headerHeight}px`)
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
        if (!target.closest('[role="dialog"]')) {
          const bounds = tutorialSafeVerticalBounds({ viewport: vp, target: target.getBoundingClientRect(), blockers: blockers(target) })
          const delta = tutorialScrollDelta(target.getBoundingClientRect(), bounds)
          if (Math.abs(delta) > 1 && target.getBoundingClientRect().height <= bounds.bottom - bounds.top) {
            window.scrollBy({ top: delta, behavior: 'instant' })
          }
        }
      }
      updateJournalInteraction()
      delete root.dataset.tutorialAutoscrolling
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(position) }
    const layoutChanged = () => { userScrolled = false; schedule() }
    const cancel = (event: Event) => {
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
      if (event instanceof PointerEvent && event.target instanceof Element
        && event.target.closest('button, input, select, textarea, a, summary, [role="tab"]')) return
      userScrolled = true
      // Closing and reopening the same lesson must keep its restored reading
      // position. A new lesson has a different key and may position its task.
      if (query(anchorSelector)?.closest('[role="dialog"]')) manualReadingTasks.current.add(readingTask)
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
    const mutations = new MutationObserver(observe)
    mutations.observe(document.body, { childList: true, subtree: true })
    for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(event, cancel, { passive: true })
    window.addEventListener('resize', layoutChanged)
    window.visualViewport?.addEventListener('resize', layoutChanged)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.addEventListener('scroll', updateJournalInteraction, { passive: true })
    observe()
    settleTimer = window.setTimeout(schedule, 160)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settleTimer)
      observer.disconnect()
      mutations.disconnect()
      for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.removeEventListener(event, cancel)
      window.removeEventListener('resize', layoutChanged)
      window.visualViewport?.removeEventListener('resize', layoutChanged)
      window.visualViewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('scroll', updateJournalInteraction)
      for (const name of ['--tutorial-journal-entry-cutout', '--tutorial-pilot-coach-height', '--tutorial-pilot-header-height', '--tutorial-pilot-action-height', '--tutorial-pilot-action-position', '--tutorial-mobile-action-height', '--tutorial-mobile-action-position', '--tutorial-mobile-coach-bottom']) root.style.removeProperty(name)
      root.removeAttribute('data-tutorial-pilot-constrained')
      delete root.dataset.tutorialAutoscrolling
    }
  }, [taskKey, manualReadingTasks, anchorSelector, secondarySelector, fallbackSelector, onTargetResolved, compactLayout, journalEntryAllowed])
  return null
}

function CoachContent({
  hint,
  onExit,
  onContinue,
  task,
  pilot,
  thesisFeedback,
  progress,
}: {
  hint?: string
  onExit: () => void
  onContinue?: () => void
  task: string
  pilot?: { action: string; why: string; expanded: boolean; onToggle: () => void }
  thesisFeedback: NonNullable<TutorialAdvanceResult['thesisFeedback']> | null
  progress: string
}) {
  const { t } = useI18n()
  return (
    <div className={styles.coach}>
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
          {t('tutorial.coach.thesisChecked')}
        </Typography>
      )}
      {hint && <Typography variant="bodySm" className={styles.hint}>{hint}</Typography>}
      {!pilot && <Typography as="strong" variant="bodySmMedium" className={styles.confirmAction}>
        {t('tutorial.coach.confirmAction')}
      </Typography>}
      <div className={styles.coachActions}>
        {pilot && <Button type="button" variant="ghost" size="sm"
          aria-expanded={pilot.expanded} aria-controls="tutorial-coach-explanation" onClick={pilot.onToggle}>
          {t('tutorial.pilot.more')}
        </Button>}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('tutorial.exit')}
          onClick={onExit}
        >
          {t('tutorial.exit.short')}
        </Button>
        {onContinue && <Button type="button" size="sm" onClick={onContinue}>{t('tutorial.coach.continue')}</Button>}
      </div>
    </div>
  )
}

function TutorialTooltip({ index, step, tooltipProps }: TooltipRenderProps) {
  return (
    <Card
      {...tooltipProps}
      aria-labelledby="tutorial-coach-title"
      className={styles.coachCard}
      data-joyride-step={index}
      data-tutorial-step={step.data.tutorialStep}
      data-tutorial-pilot={step.data.pilot || undefined}
      size="sm"
    >
      <CardContent>{step.content}</CardContent>
    </Card>
  )
}
