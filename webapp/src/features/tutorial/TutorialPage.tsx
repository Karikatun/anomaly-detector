import { Joyride, type Step, type TooltipRenderProps } from 'react-joyride'
import { useLayoutEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { TranslationKey } from '@/platform/i18n/translations'
import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import {
  ProfileApi,
  useCompleteTutorialMutation,
} from '@/features/profile'
import {
  CreateRoomDialog,
  RoomsApi,
  useCurrentMatchQuery,
} from '@/features/rooms'
import {
  TutorialTenderBoard,
  type TenderCommandInput,
} from '@/features/tender/public/tutorial-board'
import { useI18n } from '@/platform/i18n'
import {
  advanceTutorial,
  createTutorialState,
  tutorialView,
  type TutorialAction,
  type TutorialStep,
} from './scenario'
import {
  clearTutorialSession,
  loadTutorialSession,
  saveTutorialSession,
} from './session'
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

export function TutorialPage() {
  return <ProtectedPage><TutorialContent /></ProtectedPage>
}

function TutorialContent() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const playerId = auth.user?.id ?? ''
  const roomsApi = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const profileApi = useMemo(() => new ProfileApi(auth.transport), [auth.transport])
  const currentMatch = useCurrentMatchQuery(roomsApi)
  const completeTutorial = useCompleteTutorialMutation(profileApi)
  const [state, setState] = useState(() => loadTutorialSession(sessionStorage, playerId))
  const [completionSaveStatus, setCompletionSaveStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>(
    () => state.step === 'complete' ? 'error' : 'idle',
  )
  const [commandError, setCommandError] = useState<string | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const [compactHeader, setCompactHeader] = useState(
    () => window.matchMedia('(max-width: 47.999rem)').matches,
  )

  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 47.999rem)')
    const syncViewport = () => setCompactHeader(media.matches)
    syncViewport()
    media.addEventListener('change', syncViewport)
    return () => media.removeEventListener('change', syncViewport)
  }, [])

  const saveCompletion = async () => {
    setCompletionSaveStatus('pending')
    try {
      await completeTutorial.mutateAsync()
      clearTutorialSession(sessionStorage)
      setCompletionSaveStatus('saved')
    } catch {
      setCompletionSaveStatus('error')
    }
  }

  const applyAction = async (action: TutorialAction) => {
    const result = advanceTutorial(state, action)
    const stateChanged = result.state !== state
    if (stateChanged) {
      setState(result.state)
      saveTutorialSession(sessionStorage, result.state)
    }
    const isDraftSave = action.type === 'update-scientific-model-draft'
    const isThesisAttempt = action.type === 'submit-thesis' && result.thesisFeedback !== undefined
    setCommandError(result.progressed || isDraftSave || isThesisAttempt
      ? null
      : t(state.step === 'round-1-power'
        ? 'tutorial.coach.powerRound1Invalid'
        : state.step === 'round-2-power'
          ? 'tutorial.coach.powerRound2Invalid'
          : state.step === 'round-2-working-model'
            ? 'tutorial.coach.modelCheck'
            : 'tutorial.coach.invalid'))

    if (result.state.step === 'complete' && state.step !== 'complete') {
      await saveCompletion()
    }

    return result.progressed
  }

  const returnToCurrentMatch = () => {
    const match = currentMatch.data
    if (!match) return
    if (match.status === 'started' && match.tenderId) {
      void navigate({ to: '/tenders/$tenderId', params: { tenderId: match.tenderId }, search: { from: undefined } })
    } else {
      void navigate({ to: '/rooms/$roomId', params: { roomId: match.roomId } })
    }
  }

  const restart = () => {
    clearTutorialSession(sessionStorage)
    const fresh = createTutorialState(playerId)
    saveTutorialSession(sessionStorage, fresh)
    setCommandError(null)
    setCompletionSaveStatus('idle')
    setState(fresh)
  }

  const exit = () => {
    clearTutorialSession(sessionStorage)
    setExitOpen(false)
    void navigate({ to: '/' })
  }

  if (currentMatch.isPending) {
    return (
      <TutorialStateCard>
        <CardContent className={styles.stateLoading}><Spinner /></CardContent>
      </TutorialStateCard>
    )
  }
  if (currentMatch.isError) {
    return (
      <TutorialStateCard>
        <CardHeader><CardTitle role="alert">{t('tutorial.loadError')}</CardTitle></CardHeader>
        <CardContent className={styles.stateContent}>
          <Button onClick={() => void currentMatch.refetch()}>{t('tutorial.retry')}</Button>
        </CardContent>
      </TutorialStateCard>
    )
  }
  if (currentMatch.data) {
    return (
      <TutorialStateCard>
        <CardHeader><CardTitle>{t('tutorial.blocked.title')}</CardTitle></CardHeader>
        <CardContent className={styles.stateContent}>
          <Typography tone="muted">{t('tutorial.blocked.description')}</Typography>
          <Button onClick={returnToCurrentMatch}>{t('tutorial.blocked.return')}</Button>
        </CardContent>
      </TutorialStateCard>
    )
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
              <Button variant="outline" onClick={() => void navigate({ to: '/' })}>
                {t('tutorial.prologue.home')}
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

  if (state.step === 'complete') {
    const completionSaved = completionSaveStatus === 'saved'
    const completionFailed = completionSaveStatus === 'error'
    return (
      <TutorialStateCard showExpeditionBackground={false}>
        <CardHeader>
          <CardTitle>
            {t(completionSaved
              ? 'tutorial.complete.title'
              : completionFailed
                ? 'tutorial.complete.saveErrorTitle'
                : 'tutorial.complete.savingTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.completeContent}>
          {completionSaved ? (
            <>
              <Typography>{t('tutorial.complete.description')}</Typography>
              <Typography tone="muted">{t('tutorial.complete.realMatch')}</Typography>
            </>
          ) : !completionFailed ? (
            <Typography tone="muted">{t('tutorial.complete.savingDescription')}</Typography>
          ) : null}
          {completionFailed && (
            <div className={styles.saveError} role="alert">
              <Typography variant="bodySm" tone="destructive">{t('tutorial.complete.saveError')}</Typography>
              <Button
                variant="outline"
                disabled={completeTutorial.isPending}
                onClick={() => void saveCompletion()}
              >
                {t('tutorial.complete.retrySave')}
              </Button>
            </div>
          )}
          {completionSaved && (
            <div className={styles.completeActions}>
              <Button onClick={() => setCreateRoomOpen(true)}>{t('tutorial.complete.create')}</Button>
              <Button variant="outline" onClick={() => void navigate({ to: '/' })}>{t('tutorial.complete.home')}</Button>
              <Button variant="ghost" onClick={restart}>{t('tutorial.complete.repeat')}</Button>
            </div>
          )}
          <CreateRoomDialog open={createRoomOpen} onOpenChange={setCreateRoomOpen} />
        </CardContent>
      </TutorialStateCard>
    )
  }

  const visibleSteps = (compactHeader
    ? orderedSteps
    : orderedSteps.filter((tutorialStep) => tutorialStep !== 'interpretation'))
    .filter((tutorialStep) => tutorialStep !== 'interaction-guide')
  const currentTaskKey: TranslationKey = (compactHeader ? mobileTaskKeys[state.step] : undefined)
    ?? (state.step === 'help-menu' && !compactHeader
      ? 'tutorial.step.helpDesktop'
      : state.step === 'round-1-working-model' && !compactHeader
        ? 'tutorial.step.round1ModelDesktop'
        : state.step === 'round-2-working-model' && !compactHeader
          ? 'tutorial.step.round2ModelDesktop'
          : taskKeys[state.step])
  const phaseTargetConfig: Record<Exclude<TutorialStep, 'complete' | 'prologue'>, {
    anchor: string
    spotlight?: string
  }> = {
    'interaction-guide': { anchor: '[data-tutorial-primary]' },
    'round-1-header': { anchor: '[data-tutorial-highlight="header"] > header' },
    'round-1-sidebar': { anchor: '[data-tutorial-sidebar]' },
    'round-1-contracts': { anchor: '[data-tutorial-contracts]' },
    'round-1-access-intro': { anchor: '[data-tutorial-primary]' },
    'round-1-access': {
      anchor: '[data-tutorial-access-slot="5"]',
    },
    'round-1-power-intro': { anchor: '[data-tutorial-primary]' },
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
    'research-results-open': { anchor: '[data-testid="tutorial-research-dialog"]' },
    'help-menu': {
      anchor: compactHeader ? '[data-tutorial-help]' : '[data-tutorial-interpretation-direct]',
    },
    interpretation: { anchor: '[data-tutorial-interpretation]' },
    'interpretation-open': {
      anchor: '[data-testid="tutorial-interpretation-dialog"]',
    },
    'round-1-model-intro': { anchor: '[data-tutorial-primary]' },
    'round-1-working-model': {
      anchor: compactHeader
        ? '[data-tutorial-working-model-trigger]'
        : '[data-tutorial-working-model-row="aster"]',
    },
    'round-1-thesis': {
      anchor: '[data-tutorial-thesis]',
      spotlight: '[data-tutorial-thesis]',
    },
    'round-1-thesis-result': { anchor: '[data-testid="tutorial-research-trigger"]' },
    'round-1-thesis-result-open': { anchor: '[data-testid="tutorial-research-dialog"]' },
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
    'round-2-working-model': {
      anchor: compactHeader
        ? '[data-tutorial-working-model-trigger]'
        : '[data-tutorial-working-model-row="boreal"]',
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
  const targetConfig = phaseTargetConfig[state.step]
  const readingDialogOpen = state.step === 'research-results-open'
    || state.step === 'round-1-thesis-result-open'
    || state.step === 'round-2-contracts-review-open'
    || state.step === 'interpretation-open'
  const coachAtTop = (compactHeader && state.step === 'round-1-contracts')
    || readingDialogOpen
    || state.step === 'round-1-working-model'
    || state.step === 'round-2-working-model'
    || state.step === 'final-model'
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
        task={t(currentTaskKey)}
      />
    ),
    data: { tutorialStep: state.step },
    placement: 'auto',
    scrollOffset: 20,
    scrollTarget: targetConfig.anchor,
    skipScroll: true,
    spotlightTarget: targetConfig.spotlight ?? targetConfig.anchor,
    target: targetConfig.anchor,
  }

  return (
    <>
      {!readingDialogOpen && (
        <TutorialViewportAnchor
          anchorSelector={targetConfig.anchor}
          coachAtTop={coachAtTop}
          compactHeader={compactHeader}
          spotlightSelector={targetConfig.spotlight}
        />
      )}
      {!exitOpen && <Joyride
        key={state.step}
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
          overlayColor: 'rgba(0, 5, 12, .72)',
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
      <Typography aria-live="polite" variant="srOnly">{t(currentTaskKey)}</Typography>
      <TutorialTenderBoard
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
        onInterpretationClosed={() => void applyAction({ type: 'close-interpretation' })}
        onInterpretationOpened={() => void applyAction({ type: 'open-interpretation' })}
        onLaboratoryModeSelected={(mode) => void applyAction({ type: 'select-laboratory-mode', mode })}
        onResearchClosed={() => void applyAction({ type: 'close-research-results' })}
        onResearchOpened={() => void applyAction({ type: 'open-research-results' })}
        onSaveWorkingModel={(workingModel) => applyAction({ type: 'update-working-model', workingModel })}
        view={tutorialView(state)}
      />
      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent>
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

function TutorialViewportAnchor({
  anchorSelector,
  coachAtTop,
  compactHeader,
  spotlightSelector,
}: {
  anchorSelector: string
  coachAtTop: boolean
  compactHeader: boolean
  spotlightSelector?: string
}) {
  useLayoutEffect(() => {
    let coachObserver: ResizeObserver | undefined
    let layoutSettleTimer: number | undefined
    let revealSpotlightTimer: number | undefined
    let scrollEndHandler: (() => void) | undefined
    let scrollHandler: (() => void) | undefined
    let lastRequestedScrollTop: number | undefined
    const revealSpotlight = () => {
      delete document.documentElement.dataset.tutorialAutoscrolling
    }
    const scheduleSpotlightReveal = (delay = 140) => {
      if (revealSpotlightTimer !== undefined) window.clearTimeout(revealSpotlightTimer)
      revealSpotlightTimer = window.setTimeout(revealSpotlight, delay)
    }
    if (compactHeader) {
      document.documentElement.dataset.tutorialAutoscrolling = ''
    }
    const frame = window.requestAnimationFrame(() => {
      const anchor = document.querySelector<HTMLElement>(anchorSelector)
      if (!anchor) {
        scheduleSpotlightReveal()
        return
      }

      const positionTarget = () => {
        const coach = document.querySelector<HTMLElement>('[data-testid="floater"]')
        const header = document.querySelector<HTMLElement>('[data-tutorial-board] > header')
        const coachRect = coach?.getBoundingClientRect()
        const headerRect = header?.getBoundingClientRect()
        const safeTop = compactHeader
          ? coachAtTop
            ? (coachRect?.bottom ?? 276) + 12
            : Math.max(12, (headerRect?.bottom ?? 100) + 20)
          : 88
        const safeBottom = compactHeader && !coachAtTop
          ? (coachRect?.top ?? window.innerHeight - 276) - 12
          : window.innerHeight - 12
        const safeHeight = safeBottom - safeTop
        const spotlight = spotlightSelector
          ? document.querySelector<HTMLElement>(spotlightSelector)
          : null
        const preferredTarget = spotlight && spotlight.getBoundingClientRect().height <= safeHeight
          ? spotlight
          : anchor
        const rect = preferredTarget.getBoundingClientRect()

        if (compactHeader && coachAtTop && coachRect) {
          document.documentElement.style.setProperty(
            '--tutorial-mobile-coach-bottom',
            `${coachRect.bottom}px`,
          )
        }
        if (rect.height > safeHeight) {
          scheduleSpotlightReveal()
          return
        }
        const shouldPositionTarget = rect.top < safeTop || rect.bottom > safeBottom
        if (shouldPositionTarget) {
          const contentScrollLimit = Math.max(
            0,
            Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
              - window.innerHeight,
          )
          const targetScrollTop = Math.max(
            0,
            Math.min(window.scrollY + rect.top - safeTop, contentScrollLimit),
          )
          const repeatsLastTarget = lastRequestedScrollTop !== undefined
            && Math.abs(lastRequestedScrollTop - targetScrollTop) < 1
          const autoScrollInProgress = 'tutorialAutoscrolling' in document.documentElement.dataset
          if (repeatsLastTarget
            && (autoScrollInProgress || Math.abs(window.scrollY - targetScrollTop) < 1)) return
          lastRequestedScrollTop = targetScrollTop
          const smoothScroll = compactHeader
            && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
          if (smoothScroll) {
            document.documentElement.dataset.tutorialAutoscrolling = ''
            scheduleSpotlightReveal(1_000)
          }
          window.scrollTo({
            behavior: smoothScroll ? 'smooth' : 'instant',
            top: targetScrollTop,
          })
        } else if ('tutorialAutoscrolling' in document.documentElement.dataset) {
          scheduleSpotlightReveal()
        }
      }

      positionTarget()
      layoutSettleTimer = window.setTimeout(positionTarget, 260)
      scrollEndHandler = () => {
        positionTarget()
        scheduleSpotlightReveal()
      }
      window.addEventListener('scrollend', scrollEndHandler)
      scrollHandler = () => {
        if ('tutorialAutoscrolling' in document.documentElement.dataset) {
          scheduleSpotlightReveal()
        }
      }
      window.addEventListener('scroll', scrollHandler, { passive: true })
      const coach = document.querySelector<HTMLElement>('[data-testid="floater"]')
      if (coach) {
        coachObserver = new ResizeObserver(positionTarget)
        coachObserver.observe(coach)
      }
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (layoutSettleTimer !== undefined) window.clearTimeout(layoutSettleTimer)
      if (revealSpotlightTimer !== undefined) window.clearTimeout(revealSpotlightTimer)
      if (scrollEndHandler) window.removeEventListener('scrollend', scrollEndHandler)
      if (scrollHandler) window.removeEventListener('scroll', scrollHandler)
      coachObserver?.disconnect()
      revealSpotlight()
      document.documentElement.style.removeProperty('--tutorial-mobile-coach-bottom')
    }
  }, [anchorSelector, coachAtTop, compactHeader, spotlightSelector])

  return null
}

function CoachContent({
  hint,
  onExit,
  onContinue,
  task,
  progress,
}: {
  hint?: string
  onExit: () => void
  onContinue?: () => void
  task: string
  progress: string
}) {
  const { t } = useI18n()
  return (
    <div className={styles.coach}>
      <Typography variant="caption" tone="muted">{progress}</Typography>
      <Typography id="tutorial-coach-title" as="strong" variant="bodySmMedium">{t('tutorial.coach.task')}</Typography>
      <Typography variant="bodySm">{task}</Typography>
      {hint && <Typography variant="bodySm" className={styles.hint}>{hint}</Typography>}
      {onContinue && <Button type="button" size="sm" onClick={onContinue}>{t('tutorial.coach.continue')}</Button>}
      <Typography as="strong" variant="bodySmMedium" className={styles.confirmAction}>
        {t('tutorial.coach.confirmAction')}
      </Typography>
      <Button type="button" variant="ghost" size="sm" onClick={onExit}>{t('tutorial.exit')}</Button>
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
      size="sm"
    >
      <CardContent>{step.content}</CardContent>
    </Card>
  )
}

function TutorialStateCard({
  children,
  showExpeditionBackground = true,
}: {
  children: React.ReactNode
  showExpeditionBackground?: boolean
}) {
  return (
    <section className={styles.statePage}>
      {showExpeditionBackground && <ExpeditionBackground />}
      <Card className={styles.stateCard}>{children}</Card>
    </section>
  )
}
