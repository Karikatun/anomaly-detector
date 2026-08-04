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
  useTutorialProgressQuery,
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

const taskKeys: Record<Exclude<TutorialStep, 'complete'>, TranslationKey> = {
  'round-1-access': 'tutorial.step.round1Access',
  'round-1-power': 'tutorial.step.round1Power',
  'round-1-recon': 'tutorial.step.round1Recon',
  'round-1-lab': 'tutorial.step.round1Lab',
  'help-menu': 'tutorial.step.help',
  interpretation: 'tutorial.step.interpretation',
  'interpretation-open': 'tutorial.step.interpretationOpen',
  'round-1-working-model': 'tutorial.step.round1Model',
  'round-1-thesis': 'tutorial.step.round1Thesis',
  'round-2-access': 'tutorial.step.round2Access',
  'round-2-power': 'tutorial.step.round2Power',
  'round-2-recon': 'tutorial.step.round2Recon',
  'round-2-lab': 'tutorial.step.round2Lab',
  'round-2-working-model': 'tutorial.step.round2Model',
  'round-2-thesis': 'tutorial.step.round2Thesis',
  'round-2-contract-reserve': 'tutorial.step.contractReserve',
  'round-2-contract-bid': 'tutorial.step.contractBid',
  'final-model': 'tutorial.step.finalModel',
}

const orderedSteps = Object.keys(taskKeys) as Array<Exclude<TutorialStep, 'complete'>>

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
  const tutorialProgress = useTutorialProgressQuery(profileApi)
  const completeTutorial = useCompleteTutorialMutation(profileApi)
  const [state, setState] = useState(() => loadTutorialSession(sessionStorage, playerId))
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
    try {
      await completeTutorial.mutateAsync()
      clearTutorialSession(sessionStorage)
    } catch {
      // The result screen keeps the retry action visible.
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
      : t('tutorial.coach.invalid'))

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

  if (state.step === 'complete') {
    const completionSaved = Boolean(tutorialProgress.data?.completedAt)
    return (
      <TutorialStateCard>
        <CardHeader><CardTitle>{t('tutorial.complete.title')}</CardTitle></CardHeader>
        <CardContent className={styles.completeContent}>
          <Typography>{t('tutorial.complete.description')}</Typography>
          <Typography tone="muted">{t('tutorial.complete.realMatch')}</Typography>
          {!completionSaved && (
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
          <div className={styles.completeActions}>
            <Button onClick={() => setCreateRoomOpen(true)}>{t('tutorial.complete.create')}</Button>
            <Button variant="outline" onClick={() => void navigate({ to: '/' })}>{t('tutorial.complete.home')}</Button>
            <Button variant="ghost" onClick={restart}>{t('tutorial.complete.repeat')}</Button>
          </div>
          <CreateRoomDialog open={createRoomOpen} onOpenChange={setCreateRoomOpen} />
        </CardContent>
      </TutorialStateCard>
    )
  }

  const visibleSteps = compactHeader
    ? orderedSteps
    : orderedSteps.filter((tutorialStep) => tutorialStep !== 'interpretation')
  const currentTaskKey = state.step === 'help-menu' && !compactHeader
    ? 'tutorial.step.helpDesktop'
    : state.step === 'round-1-working-model' && !compactHeader
      ? 'tutorial.step.round1ModelDesktop'
      : state.step === 'round-2-working-model' && !compactHeader
        ? 'tutorial.step.round2ModelDesktop'
        : taskKeys[state.step]
  const phaseTargetConfig: Record<Exclude<TutorialStep, 'complete'>, {
    anchor: string
    spotlight?: string
  }> = {
    'round-1-access': {
      anchor: '[data-tutorial-access-slot="5"]',
      spotlight: '[data-tutorial-access-options]',
    },
    'round-1-power': {
      anchor: '[data-tutorial-power-category="reconnaissance"]',
      spotlight: '[data-tutorial-power-options]',
    },
    'round-1-recon': {
      anchor: '[data-tutorial-recon-anchor]',
      spotlight: '[data-tutorial-recon-options]',
    },
    'round-1-lab': {
      anchor: '[data-tutorial-lab-sample="aster"]',
      spotlight: '[data-tutorial-lab-options]',
    },
    'help-menu': {
      anchor: compactHeader ? '[data-tutorial-help]' : '[data-tutorial-interpretation-direct]',
    },
    interpretation: { anchor: '[data-tutorial-interpretation]' },
    'interpretation-open': {
      anchor: '[data-testid="tutorial-interpretation-dialog"] button',
    },
    'round-1-working-model': {
      anchor: compactHeader
        ? '[data-tutorial-working-model-trigger]'
        : '[data-tutorial-working-model-row="aster"]',
    },
    'round-1-thesis': {
      anchor: '[data-tutorial-thesis] select',
      spotlight: '[data-tutorial-thesis]',
    },
    'round-2-access': {
      anchor: '[data-tutorial-access-slot="4"]',
      spotlight: '[data-tutorial-access-options]',
    },
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
    'round-2-contract-reserve': {
      anchor: '[data-contract-id="tutorial-light-contract"]',
    },
    'round-2-contract-bid': {
      anchor: '[data-contract-id="tutorial-light-contract"]',
    },
    'final-model': {
      anchor: '[data-tutorial-final-submit]',
    },
  }
  const targetConfig = phaseTargetConfig[state.step]
  const coachAtTop = state.step === 'interpretation-open'
    || state.step === 'round-1-working-model'
    || state.step === 'round-2-working-model'
    || state.step === 'final-model'
  const highlight = state.step === 'help-menu'
    ? 'help' as const
    : state.step === 'interpretation' || state.step === 'interpretation-open'
      ? 'interpretation' as const
      : state.step === 'round-1-working-model' || state.step === 'round-2-working-model'
        ? 'working-model' as const
        : 'primary' as const
  const step: Step = {
    content: (
      <CoachContent
        current={visibleSteps.indexOf(state.step) + 1}
        hint={state.hintLevel > 0 ? t('tutorial.coach.hint') : undefined}
        onExit={() => setExitOpen(true)}
        task={t(currentTaskKey)}
        total={visibleSteps.length}
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
      {state.step !== 'interpretation-open' && (
        <TutorialViewportAnchor
          anchorSelector={targetConfig.anchor}
          coachAtTop={coachAtTop}
          compactHeader={compactHeader}
          spotlightSelector={targetConfig.spotlight}
        />
      )}
      <Joyride
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
          blockTargetInteraction: false,
          buttons: [],
          disableFocusTrap: true,
          dismissKeyAction: false,
          overlayClickAction: false,
          overlayColor: 'rgba(0, 5, 12, .42)',
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
      />
      <Typography aria-live="polite" variant="srOnly">{t(currentTaskKey)}</Typography>
      <TutorialTenderBoard
        commandError={commandError}
        highlight={highlight}
        interpretationRequired={state.step === 'help-menu' || state.step === 'interpretation' || state.step === 'interpretation-open'}
        onCommand={async (command: TenderCommandInput) => {
          await applyAction(command)
        }}
        onExitRequest={() => setExitOpen(true)}
        onHelpMenuOpened={() => void applyAction({ type: 'open-help-menu' })}
        onDirectInterpretationOpened={() => void applyAction({ type: 'open-interpretation-direct' })}
        onInterpretationClosed={() => void applyAction({ type: 'close-interpretation' })}
        onInterpretationOpened={() => void applyAction({ type: 'open-interpretation' })}
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
    const anchor = document.querySelector<HTMLElement>(anchorSelector)
    if (!anchor) return

    const safeTop = compactHeader ? (coachAtTop ? 288 : 120) : 88
    const safeBottom = compactHeader && !coachAtTop ? window.innerHeight - 288 : window.innerHeight - 12
    const safeHeight = safeBottom - safeTop
    const spotlight = spotlightSelector
      ? document.querySelector<HTMLElement>(spotlightSelector)
      : null
    const preferredTarget = spotlight && spotlight.getBoundingClientRect().height <= safeHeight
      ? spotlight
      : anchor
    const rect = preferredTarget.getBoundingClientRect()

    if (rect.top < safeTop || rect.bottom > safeBottom) {
      window.scrollBy({
        behavior: 'instant',
        top: rect.top - safeTop - 12,
      })
    }
  }, [anchorSelector, coachAtTop, compactHeader, spotlightSelector])

  return null
}

function CoachContent({
  current,
  hint,
  onExit,
  task,
  total,
}: {
  current: number
  hint?: string
  onExit: () => void
  task: string
  total: number
}) {
  const { t } = useI18n()
  return (
    <div className={styles.coach}>
      <Typography variant="caption" tone="muted">{t('tutorial.coach.progress', { current, total })}</Typography>
      <Typography id="tutorial-coach-title" as="strong" variant="bodySmMedium">{t('tutorial.coach.task')}</Typography>
      <Typography variant="bodySm">{task}</Typography>
      {hint && <Typography variant="bodySm" className={styles.hint}>{hint}</Typography>}
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

function TutorialStateCard({ children }: { children: React.ReactNode }) {
  return (
    <section className={styles.statePage}>
      <ExpeditionBackground />
      <Card className={styles.stateCard}>{children}</Card>
    </section>
  )
}
