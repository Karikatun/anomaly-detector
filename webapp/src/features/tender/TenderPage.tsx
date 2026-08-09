import { translate } from '../../platform/i18n'
import { InformationCircleIcon, Logout01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { profileQueryKeys } from '@/features/profile'
import { roomQueryKeys } from '@/features/rooms'
import { LaboratoryInterpretationDialog, RulesReferenceDialog } from '@/features/rules'
import { ApiRequestError } from '@/platform/api'
import { useI18n } from '@/platform/i18n'
import type { TranslationKey } from '@/platform/i18n/translations'
import { useSynchronizedCountdown } from '@/platform/time/synchronized-countdown'
import { AccessSlotPanel } from './AccessSlotPanel'
import { ContractsPanel } from './ContractsPanel'
import { FinalScientificModelPanel } from './FinalScientificModelPanel'
import { LaboratoryPanel } from './LaboratoryPanel'
import { ModelAnalysisPanel } from './ModelAnalysisPanel'
import { PowerAllocationPanel } from './PowerAllocationPanel'
import { ReconnaissancePanel, ReconnaissanceUnavailable } from './ReconnaissancePanel'
import { TenderTimer } from './TenderTimer'
import { ReconnectOverlay } from './components/ReconnectOverlay'
import { PhaseNotice, UnavailablePhaseCard } from './components/TenderActionPanel'
import { TenderPhaseProgress } from './components/TenderPhaseProgress'
import { TenderPhaseLayout } from './components/TenderPhaseLayout'
import {
  TenderPlanningContext,
  TenderPlayers,
} from './components/TenderOverview'
import { WorkingModelWorkspace } from './components/WorkingModelWorkspace'
import { CompletedTenderPanel } from './components/CompletedTenderPanel'
import { ContractPlanningPanel } from './components/ContractPlanningPanel'
import { TenderResearchDialog } from './components/TenderResearchDialog'
import { TenderHeaderFrame } from './components/TenderHeaderFrame'
import {
  useTenderCommands,
  type TenderCommandInput,
} from './commands'
import {
  useRealtimeTender,
  type RealtimeErrorCode,
} from './realtime'
import {
  getTenderCommandErrorKey,
} from './tender-command-feedback'
import styles from './TenderPage.module.css'
import type { WorkingModelSaveStatus } from './working-model-draft'
import { tenderRulesetPolicy } from './ruleset-policy'
import { getPhaseContextMenuVisibility, shouldLockPhaseOverlays } from './phase-ui'

const phaseLabels: Record<string, string> = {
  'access-slot-selection': translate('tender.tenderPage.copy.001'),
  'power-allocation': translate('tender.tenderPage.copy.002'),
  'reconnaissance': translate('tender.tenderPage.copy.003'),
  'laboratory': translate('tender.tenderPage.copy.004'),
  'model-analysis': translate('tender.tenderPage.copy.005'),
  'contracts': translate('tender.tenderPage.copy.006'),
  'final-scientific-model': translate('tender.tenderPage.copy.007'),
  'complete': translate('tender.tenderPage.copy.008'),
}

const sequentialPhases = new Set([
  'reconnaissance',
  'laboratory',
  'model-analysis',
  'contracts',
  'final-scientific-model',
])

const realtimeErrorKeys = {
  'connection-failed': 'tender.realtime.error.connection-failed',
  'ticket-failed': 'tender.realtime.error.ticket-failed',
  'invalid-message': 'tender.realtime.error.invalid-message',
  'server-error': 'tender.realtime.error.server-error',
} as const satisfies Record<RealtimeErrorCode, TranslationKey>

function WaitingForTurn({
  playerName,
}: {
  playerName?: string
}) {
  return (
    <PhaseNotice
      kind="waiting"
      description={translate('tender.tenderPage.copy.009', { value1: playerName ?? translate('tender.player.fallback') })}
    >
      
      {translate('tender.tenderPage.copy.010')}
    </PhaseNotice>
  )
}

export function PhasePanel({
  view,
  disabled,
  pending = false,
  error,
  onCommand,
  onSaveWorkingModel,
  activePlayerId,
  workingModelDialog,
  training,
}: {
  view: TenderView
  disabled: boolean
  pending?: boolean
  error: string | null
  onCommand: (cmd: TenderCommandInput) => Promise<void>
  onSaveWorkingModel: (workingModel: TenderView['privateWorkingModel']) => Promise<void>
  activePlayerId?: string
  workingModelDialog: {
    actionError?: string | null
    onOpenChange: (open: boolean) => void
    onSaveStatusChange: (status: WorkingModelSaveStatus) => void
    open: boolean
    openDisabled: boolean
  }
  training?: {
    laboratoryInitialMode?: 'broad' | 'deep'
    onLaboratoryModeSelect?: (mode: 'broad' | 'deep') => void
    separateContractReservation?: boolean
    untimed?: boolean
  }
}) {
  const auth = useAuth()
  const myPlayer = view.players.find((p) => p.playerId === auth.user?.id)
  const mySamples = myPlayer ? view.privateSamples : []
  const myPower = myPlayer?.powerAllocation
  const activePlayer = view.players.find((player) => player.playerId === activePlayerId)
  const policy = tenderRulesetPolicy(view.ruleset)
  const isSharedModelAnalysis = view.phase === 'model-analysis' && policy.sharedModelAnalysis
  const isSharedFinalScientificModel = view.phase === 'final-scientific-model'
    && policy.sharedFinalScientificModel
  const isWaitingForTurn = sequentialPhases.has(view.phase)
    && !isSharedModelAnalysis
    && !isSharedFinalScientificModel
    && activePlayerId !== auth.user?.id
  const withWaitingState = (content: ReactNode) => (
    <>
      {isWaitingForTurn && (
        <WaitingForTurn
          playerName={activePlayer?.displayName}
        />
      )}
      {content}
    </>
  )

  switch (view.phase) {
    case 'access-slot-selection':
      return (
        <AccessSlotPanel
          budget={myPlayer?.budget ?? 0}
          disabled={disabled || myPlayer?.requestedAccessSlot !== undefined}
          confirmedSlot={myPlayer?.requestedAccessSlot}
          currentUserId={auth.user?.id}
          error={error}
          onConfirm={(slot) => onCommand({ type: 'request-access-slot', slot })}
          tiePriorityOrder={view.players}
        >
          {view.round > 1 && (
            <TenderPlanningContext samples={mySamples} />
          )}
        </AccessSlotPanel>
      )

    case 'power-allocation':
      return (
        <PowerAllocationPanel
          confirmedAllocation={myPlayer?.powerAllocation}
          currentUserId={auth.user?.id}
          sampleCount={mySamples.length}
          disabled={disabled || myPlayer?.powerAllocation !== undefined}
          error={error}
          players={view.players}
          onConfirm={(allocation) => onCommand({ type: 'allocate-power', allocation })}
        />
      )

    case 'reconnaissance': {
      const reconPower = myPower?.reconnaissance ?? 0
      return reconPower > 0 ? withWaitingState(
        <ReconnaissancePanel
          knownSignals={view.knownSignals}
          mySamples={mySamples}
          maxSignals={reconPower}
          disabled={disabled || isWaitingForTurn}
          error={error}
          onConfirm={(targets) => onCommand({ type: 'conduct-reconnaissance', targets })}
        />,
      ) : (
        <ReconnaissanceUnavailable mySamples={mySamples} />
      )
    }

    case 'laboratory': {
      const labPower = myPower?.laboratory ?? 0
      return labPower > 0 ? withWaitingState(
        <LaboratoryPanel
          journal={view.publicScientificJournal}
          mySamples={mySamples}
          playerId={auth.user?.id ?? ''}
          privateMeasurements={view.privateMeasurements}
          powerAllocation={labPower}
          ruleset={view.ruleset}
          initialMode={training?.laboratoryInitialMode}
          onModeSelect={training?.onLaboratoryModeSelect}
          disabled={disabled || isWaitingForTurn}
          pending={pending}
          error={error}
          onConfirm={(laboratory) => {
            if (!policy.versionedLaboratory) {
              const pair = laboratory.mode === 'broad'
                ? laboratory.pairs[0]
                : laboratory.pair
              return onCommand({
                type: 'run-laboratory-test',
                protocol: laboratory.mode === 'deep' ? 'continuous' : 'impulse',
                ...pair,
              })
            }
            return onCommand({ type: 'run-laboratory-test', laboratory })
          }}
        />,
      ) : (
        <UnavailablePhaseCard>{translate('tender.tenderPage.copy.011')}</UnavailablePhaseCard>
      )
    }

    case 'model-analysis': {
      const maPower = myPower?.modelAnalysis ?? 0
      return maPower > 0 ? withWaitingState(
        <ModelAnalysisPanel
          knownSignals={view.knownSignals}
          maxTheses={maPower}
          model={view.privateWorkingModel}
          publicTheses={view.publicTheses}
          privateTheses={view.privateTheses}
          progress={view.modelAnalysisProgress}
          round={view.round}
          ruleset={view.ruleset}
          disabled={disabled || isWaitingForTurn || myPlayer?.modelAnalysisCompleted}
          workingModelDisabled={disabled}
          workingModelDialog={workingModelDialog}
          workingModelSignals={mySamples}
          error={error}
          onConfirmThesis={(input) => onCommand({ type: 'submit-thesis', ...input })}
          onFinish={() => onCommand({ type: 'finish-model-analysis' })}
          onSaveWorkingModel={onSaveWorkingModel}
        />,
      ) : (
        <UnavailablePhaseCard>{translate('tender.tenderPage.copy.012')}</UnavailablePhaseCard>
      )
    }

    case 'contracts': {
      const contractPower = myPower?.contracts ?? 0
      const restriction = myPlayer?.contractPowerRestriction ?? 0
      const effective = Math.max(0, contractPower - restriction)
      return effective > 0 ? withWaitingState(
        <ContractsPanel
          certifications={view.privateResearchCertifications ?? []}
          contracts={[...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]}
          journal={view.publicScientificJournal ?? []}
          maxPower={effective}
          playerId={auth.user?.id ?? ''}
          players={view.players}
          privateUsedContractEvidenceTestIds={view.privateUsedContractEvidenceTestIds ?? []}
          round={view.round}
          disabled={disabled || isWaitingForTurn}
          error={error}
          separateReservation={training?.separateContractReservation}
          onReserve={(contractId) => onCommand({ type: 'reserve-contract', contractId })}
          onSkip={() => onCommand({ type: 'skip-contract' })}
          onBid={(contractId, bid) =>
            onCommand({ type: 'submit-contract-bid', contractId, ...bid })
          }
        />,
      ) : (
        <UnavailablePhaseCard>{translate('tender.tenderPage.copy.013')}</UnavailablePhaseCard>
      )
    }

    case 'final-scientific-model': {
      return withWaitingState(
        <FinalScientificModelPanel
          draft={view.privateFinalScientificModelSubmission?.scientificModel
            ?? view.privateFinalScientificModelDraft
            ?? { signals: {} }}
          dueAt={view.dueAt ?? null}
          disabled={disabled || isWaitingForTurn}
          error={error}
          onConfirm={(scientificModel) => onCommand({ type: 'submit-scientific-model', scientificModel })}
          onSaveDraft={(scientificModelDraft) =>
            onCommand({ type: 'update-scientific-model-draft', scientificModelDraft })
          }
          progress={view.finalScientificModelProgress}
          serverTime={view.serverTime}
          submitted={myPlayer?.finalScientificModelSubmitted}
          untimed={training?.untimed}
        />,
      )
    }

    case 'complete':
      return view.audit ? (
        <CompletedTenderPanel currentUserId={auth.user?.id} view={{ ...view, audit: view.audit }} />
      ) : (
        <Card>
          <CardHeader><CardTitle>{translate('tender.tenderPage.copy.014')}</CardTitle></CardHeader>
          <CardContent><Typography tone="muted">{translate('tender.tenderPage.copy.015')}</Typography></CardContent>
        </Card>
      )

    default:
      return (
        <Card>
          <CardHeader><CardTitle>{phaseLabels[view.phase] ?? view.phase}</CardTitle></CardHeader>
          <CardContent><Typography tone="muted">{translate('tender.tenderPage.copy.016')}</Typography></CardContent>
        </Card>
      )
  }
}

export function TenderPage() {
  return (
    <ProtectedPage>
      <TenderContent />
    </ProtectedPage>
  )
}

function TenderContent() {
  const { tenderId } = useParams({ strict: false }) as { tenderId: string }
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const tenderSearch = useSearch({ from: '/tenders/$tenderId' })
  const queryClient = useQueryClient()

  const { connected, error, retry, tenderView } = useRealtimeTender(auth.transport, tenderId)
  const { execute } = useTenderCommands(auth.transport, tenderId, auth.user?.id ?? '')
  const [commandError, setCommandError] = useState<{ message: string; version: number } | null>(null)
  const [resuming, setResuming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [laboratoryHelpOpen, setLaboratoryHelpOpen] = useState(false)
  const [helpMenuOpen, setHelpMenuOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [workingModelOpen, setWorkingModelOpen] = useState(false)
  const [contextModal, setContextModal] = useState<'research' | 'working-model' | 'contracts' | null>(null)
  const [overlayPhase, setOverlayPhase] = useState<string | null>(null)
  const [workingModelSaveError, setWorkingModelSaveError] = useState<string | null>(null)
  const commandInFlightRef = useRef<{ promise: Promise<void>; token: symbol } | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const primaryContentRef = useRef<HTMLDivElement>(null)
  const latestTenderViewRef = useRef(tenderView)
  const previousSequentialTurnRef = useRef<string | undefined>(undefined)
  const leavingTenderIdRef = useRef<string | null>(null)
  const resumingTenderIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    latestTenderViewRef.current = tenderView
  }, [tenderView])

  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return

    const updateHeaderHeight = () => {
      document.documentElement.style.setProperty(
        '--tender-sticky-header-height',
        `${header.getBoundingClientRect().height}px`,
      )
    }
    const observer = new ResizeObserver(updateHeaderHeight)
    observer.observe(header)
    updateHeaderHeight()

    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--tender-sticky-header-height')
    }
  }, [tenderView?.phase])

  useEffect(() => {
    if (tenderView?.phase !== 'complete') return
    void queryClient.invalidateQueries({
      exact: true,
      queryKey: profileQueryKeys.statistics(),
    })
  }, [queryClient, tenderView?.phase, tenderId])

  useEffect(() => {
    if (
      !connected
      || !tenderView?.hasLeft
      || leavingTenderIdRef.current === tenderId
      || resumingTenderIdRef.current === tenderId
    ) return
    resumingTenderIdRef.current = tenderId
    setResuming(true)
    void execute({ type: 'resume-tender' })
      .catch(() => {
        resumingTenderIdRef.current = null
      })
      .finally(() => setResuming(false))
  }, [connected, execute, tenderId, tenderView?.hasLeft])

  const remainingSeconds = useSynchronizedCountdown(
    tenderView?.dueAt,
    tenderView?.serverTime ?? '1970-01-01T00:00:00.000Z',
  )

  useEffect(() => {
    const activePlayerId = tenderView?.activePlayerId
    const turnKey = tenderView && sequentialPhases.has(tenderView.phase)
      ? `${tenderView.phase}:${activePlayerId ?? ''}`
      : undefined
    const previousTurnKey = previousSequentialTurnRef.current
    previousSequentialTurnRef.current = turnKey
    if (
      !tenderView
      || previousTurnKey === undefined
      || previousTurnKey === turnKey
      || activePlayerId !== auth.user?.id
      || !sequentialPhases.has(tenderView.phase)
    ) return
    requestAnimationFrame(() => {
      setRulesOpen(false)
      setLaboratoryHelpOpen(false)
      setWorkingModelOpen(false)
      primaryContentRef.current?.focus()
    })
  }, [auth.user?.id, tenderView])

  const handleCommand = useCallback(
    (command: TenderCommandInput) => {
      if (commandInFlightRef.current) return commandInFlightRef.current.promise
      const startingView = latestTenderViewRef.current
      const token = Symbol('tender-command')
      const promise = (async () => {
        setCommandError(null)
        setSubmitting(true)
        try {
          await execute(command)
        } catch (err) {
          if (err instanceof ApiRequestError && err.code === 'TENDER_EVIDENCE_UNAVAILABLE') {
            retry()
          }
          const messageKey = getTenderCommandErrorKey({
            actorId: auth.user?.id ?? '',
            command,
            error: err,
            latestView: latestTenderViewRef.current,
            startingView,
          })
          if (messageKey === null) return
          setCommandError({
            message: t(messageKey),
            version: latestTenderViewRef.current?.version ?? startingView?.version ?? 0,
          })
          throw err
        } finally {
          if (commandInFlightRef.current?.token === token) {
            commandInFlightRef.current = null
            setSubmitting(false)
          }
        }
      })()
      commandInFlightRef.current = { promise, token }
      return promise
    },
    [auth.user?.id, execute, retry, t],
  )
  const saveWorkingModel = useCallback(
    async (workingModel: TenderView['privateWorkingModel']) => {
      if (!connected) {
        throw new Error(translate('tender.tenderPage.copy.017'))
      }
      await execute({
        type: 'update-working-model',
        workingModel,
      })
    },
    [connected, execute],
  )
  const collapseMatch = useCallback(async () => {
    setExitOpen(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: roomQueryKeys.current() }),
      queryClient.invalidateQueries({ queryKey: roomQueryKeys.mine() }),
    ])
    await navigate({ to: tenderSearch.from === 'matches' ? '/app' : '/' })
  }, [navigate, queryClient, tenderSearch.from])
  const forfeitMatch = useCallback(async () => {
    try {
      await handleCommand({ type: 'forfeit-tender' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: roomQueryKeys.current() }),
        queryClient.invalidateQueries({ queryKey: roomQueryKeys.mine() }),
      ])
      setExitOpen(false)
      await navigate({ to: '/' })
    } catch {
      // The shared command error remains visible; stay in the match so the player can retry.
    }
  }, [handleCommand, navigate, queryClient])

  if (error && !tenderView) {
    return (
      <section className="mx-auto grid min-h-dvh w-full max-w-6xl content-center gap-6 px-5 py-16">
        <Typography variant="h4" tone="destructive">{t(realtimeErrorKeys[error])}</Typography>
      </section>
    )
  }

  if (!tenderView) {
    return (
      <section className="mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center px-5 py-16">
        <div className="flex items-center gap-3">
          <Spinner />
          <Typography variant="bodySm" tone="muted">
            {connected ? translate('tender.tenderPage.copy.018') : translate('tender.tenderPage.copy.019')}
          </Typography>
        </div>
      </section>
    )
  }

  const phase = phaseLabels[tenderView.phase] ?? tenderView.phase
  const visibleCommandError = commandError?.version === tenderView.version
    ? commandError.message
    : null
  const myPlayer = tenderView.players.find((p) => p.playerId === auth.user?.id)
  const mySlot = myPlayer?.accessSlot
  const activePlayer = tenderView.players.find((player) => player.playerId === tenderView.activePlayerId)
  const policy = tenderRulesetPolicy(tenderView.ruleset)
  const isSharedModelAnalysis = tenderView.phase === 'model-analysis'
    && policy.sharedModelAnalysis
  const isSharedFinalScientificModel = tenderView.phase === 'final-scientific-model'
    && policy.sharedFinalScientificModel
  const isSharedOperationalPhase = isSharedModelAnalysis || isSharedFinalScientificModel
  const isSequentialPhase = sequentialPhases.has(tenderView.phase) && !isSharedOperationalPhase
  const isMyTurn = !isSequentialPhase || tenderView.activePlayerId === auth.user?.id
  const isAccessSlotSelection = tenderView.phase === 'access-slot-selection'
  const isPowerAllocation = tenderView.phase === 'power-allocation'
  const isComplete = tenderView.phase === 'complete'
  const contextMenuVisibility = getPhaseContextMenuVisibility(tenderView.phase)
  const hasPendingAction = isAccessSlotSelection
    ? myPlayer?.requestedAccessSlot === undefined
    : isPowerAllocation
      ? myPlayer?.powerAllocation === undefined
      : isSharedOperationalPhase
        ? isSharedModelAnalysis
          ? !myPlayer?.modelAnalysisCompleted
          : !myPlayer?.finalScientificModelSubmitted
        : isSequentialPhase && isMyTurn
  const referenceHelpUrgentlyLocked = shouldLockPhaseOverlays({
    phase: tenderView.phase,
    remainingSeconds,
  })
  const referenceHelpLockedForTurn = isSequentialPhase && isMyTurn && Boolean(hasPendingAction)
  const referenceHelpLocked = referenceHelpUrgentlyLocked || referenceHelpLockedForTurn
  const setOverlayOpen = (
    kind: 'rules' | 'interpretation' | 'research' | 'working-model' | 'contracts',
    open: boolean,
  ) => {
    setRulesOpen(open && kind === 'rules')
    setLaboratoryHelpOpen(open && kind === 'interpretation')
    setWorkingModelOpen(open && kind === 'working-model')
    setContextModal(open && (kind === 'research' || kind === 'working-model' || kind === 'contracts') ? kind : null)
    if (open) setOverlayPhase(tenderView.phase)
  }
  const handleWorkingModelSaveStatus = (status: WorkingModelSaveStatus) => {
    setWorkingModelSaveError(status.state === 'error' ? status.message : null)
  }

  return (
    <section className={`${styles.page} mx-auto w-full min-w-0 max-w-[90rem] overflow-x-clip px-3 py-3 sm:px-5 sm:py-5`}>
      <TenderHeaderFrame
        ariaLabel={t('tender.phase.status')}
        headerRef={headerRef}
        info={(
          <>
          <Typography variant="shortcut" tone="muted" className="uppercase">
            
            {translate('tender.header.round', { round: tenderView.round })}
          </Typography>
          <Typography as="h3" variant="bodySmMedium" className="truncate">{phase}</Typography>
          </>
        )}
        timer={<TenderTimer remainingSeconds={tenderView.dueAt ? remainingSeconds : null} />}
        meta={(
          <>
          {mySlot && <Badge variant="outline">{translate('tender.header.slot', { slot: mySlot })}</Badge>}
          {isAccessSlotSelection && (
            <Badge variant="outline">{translate('tender.header.budget', { budget: myPlayer?.budget ?? 0 })}</Badge>
          )}
          {isSequentialPhase && (
            <Badge variant={isMyTurn ? 'default' : 'outline'}>
              {isMyTurn ? translate('tender.tenderPage.copy.023') : translate('tender.tenderPage.copy.024', { value1: activePlayer?.displayName ?? translate('tender.player.fallbackGenitive') })}
            </Badge>
          )}
          {isSharedModelAnalysis && tenderView.modelAnalysisProgress && (
            <Badge variant="outline">
              {t('tender.phase.completed', {
                completed: tenderView.modelAnalysisProgress.completed,
                total: tenderView.modelAnalysisProgress.total,
              })}
            </Badge>
          )}
          {isSharedFinalScientificModel && tenderView.finalScientificModelProgress && (
            <Badge variant="outline">
              {t('tender.phase.completed', {
                completed: tenderView.finalScientificModelProgress.completed,
                total: tenderView.finalScientificModelProgress.total,
              })}
            </Badge>
          )}
          </>
        )}
        actions={(
          <>
          {connected ? (
            <Badge variant="outline" className={`${styles.connectionBadge} text-emerald-400`}>{t('tender.realtime.live')}</Badge>
          ) : (
            <Badge variant="outline" className={`${styles.connectionBadge} text-amber-400`}>{t('tender.realtime.reconnecting')}</Badge>
          )}
          <Dialog
            open={helpMenuOpen && !referenceHelpLocked}
            onOpenChange={(open) => setHelpMenuOpen(open && !referenceHelpLocked)}
          >
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={styles.helpAction}
                disabled={referenceHelpLocked}
              >
                <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
                <Typography as="span" variant="control">{translate('tender.tenderPage.copy.025')}</Typography>
              </Button>
            </DialogTrigger>
            <DialogContent closeLabel={translate('tender.tenderPage.copy.026')}>
              <DialogHeader>
                <DialogTitle>{translate('tender.tenderPage.copy.027')}</DialogTitle>
                <DialogDescription>{translate('tender.tenderPage.copy.028')}</DialogDescription>
              </DialogHeader>
              <div className={styles.helpMenu}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHelpMenuOpen(false)
                    setOverlayOpen('rules', true)
                  }}
                >
                  
                  {translate('tender.tenderPage.copy.029')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHelpMenuOpen(false)
                    setOverlayOpen('interpretation', true)
                  }}
                >
                  
                  {translate('tender.tenderPage.copy.030')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <RulesReferenceDialog
            belowTenderHeader
            disabled={referenceHelpLocked}
            onOpenChange={(open) => setOverlayOpen('rules', open)}
            open={rulesOpen && overlayPhase === tenderView.phase && !referenceHelpLocked}
            showTimerWarning={!isComplete}
            ruleset={tenderView.ruleset}
            triggerClassName={styles.rulesAction}
            triggerIcon="book"
          />
          <LaboratoryInterpretationDialog
            belowTenderHeader
            disabled={referenceHelpLocked}
            onOpenChange={(open) => setOverlayOpen('interpretation', open)}
            open={laboratoryHelpOpen && overlayPhase === tenderView.phase && !referenceHelpLocked}
            ruleset={tenderView.ruleset}
            showTimerWarning={!isComplete}
            triggerClassName={styles.laboratoryAction}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={styles.leaveAction}
            aria-label={t('nav.leaveMatch')}
            title={t('nav.leaveMatch')}
            disabled={submitting || resuming || tenderView.hasLeft}
            onClick={() => {
              if (tenderView.phase === 'complete') {
                void collapseMatch()
              } else {
                setExitOpen(true)
              }
            }}
          >
            <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="span" variant="control">{t('button.logout')}</Typography>
          </Button>
          <Dialog open={exitOpen} onOpenChange={setExitOpen}>
            <DialogContent closeLabel={t('tender.exit.cancel')}>
              <DialogHeader>
                <DialogTitle>{t('tender.exit.title')}</DialogTitle>
                <DialogDescription>{t('tender.exit.description')}</DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <Typography variant="bodySm" tone="muted">{t('tender.exit.timerContinues')}</Typography>
                <TenderTimer remainingSeconds={tenderView.dueAt ? remainingSeconds : null} />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">{t('tender.exit.cancel')}</Button>
                </DialogClose>
                <Button type="button" variant="outline" onClick={() => void collapseMatch()}>
                  {t('tender.exit.collapse')}
                </Button>
                <Button type="button" variant="destructive" onClick={() => void forfeitMatch()}>
                  {t('tender.exit.forfeit')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        )}
      />
      {tenderView.privateAutomaticOperationalSkip && (
        <PhaseNotice
          description={tenderView.privateAutomaticOperationalSkip.reason === 'all_pairs_researched'
            ? translate('tender.tenderPage.copy.031')
            : tenderView.privateAutomaticOperationalSkip.reason === 'insufficient_samples'
              ? translate('tender.tenderPage.copy.032')
              : translate('tender.tenderPage.copy.033')}
        >
          {tenderView.privateAutomaticOperationalSkip.phase === 'laboratory'
            ? translate('tender.tenderPage.copy.034')
            : translate('tender.tenderPage.copy.035')}
        </PhaseNotice>
      )}

      <div className={styles.content}>
        {!connected && (
          <ReconnectOverlay
            errorText={error ? t(realtimeErrorKeys[error]) : undefined}
            onRetry={retry}
          />
        )}
        {workingModelSaveError && (
          <Typography role="alert" variant="bodySm" tone="destructive">
            {workingModelSaveError}
          </Typography>
        )}

        <TenderPhaseLayout
          progress={!isComplete ? <TenderPhaseProgress phase={tenderView.phase} /> : undefined}
          primary={(
            <div
              ref={primaryContentRef}
              tabIndex={-1}
              className="grid min-w-0 self-start gap-4 outline-none"
            >
            {isSharedFinalScientificModel && (
              <TenderResearchDialog
                open={contextModal === 'research' && overlayPhase === tenderView.phase && !referenceHelpUrgentlyLocked}
                onOpenChange={(open) => setOverlayOpen('research', open)}
                view={tenderView}
              />
            )}
            <PhasePanel
              view={tenderView}
              disabled={submitting || !connected}
              pending={submitting}
              error={visibleCommandError}
              onCommand={handleCommand}
              onSaveWorkingModel={saveWorkingModel}
              activePlayerId={tenderView.activePlayerId}
              workingModelDialog={{
                onOpenChange: (open) => setOverlayOpen('working-model', open),
                onSaveStatusChange: handleWorkingModelSaveStatus,
                open: workingModelOpen && overlayPhase === tenderView.phase && !referenceHelpLocked,
                openDisabled: referenceHelpLocked,
              }}
            />

            </div>
          )}
          sidebar={!isComplete ? (
            <>
              <TenderPlayers
                activePlayerId={tenderView.activePlayerId}
                currentUserId={auth.user?.id}
                phase={tenderView.phase}
                players={tenderView.players}
              />
              {!isSharedFinalScientificModel && (
                <TenderResearchDialog
                  open={contextModal === 'research' && overlayPhase === tenderView.phase && !referenceHelpUrgentlyLocked}
                  onOpenChange={(open) => setOverlayOpen('research', open)}
                  view={tenderView}
                />
              )}
              {contextMenuVisibility.workingModel && (
                <WorkingModelWorkspace
                  disabled={!connected}
                  knownSignals={tenderView.privateSamples}
                  model={tenderView.privateWorkingModel}
                  onSave={saveWorkingModel}
                  onOpenChange={(open) => setOverlayOpen('working-model', open)}
                  onSaveStatusChange={handleWorkingModelSaveStatus}
                  open={contextModal === 'working-model' && overlayPhase === tenderView.phase && !referenceHelpUrgentlyLocked}
                  openDisabled={referenceHelpUrgentlyLocked}
                />
              )}
              {contextMenuVisibility.contracts && (
                <ContractPlanningPanel
                  open={contextModal === 'contracts' && !referenceHelpUrgentlyLocked}
                  onOpenChange={(open) => setOverlayOpen('contracts', open)}
                  view={tenderView}
                />
              )}
            </>
          ) : undefined}
        />
      </div>
    </section>
  )
}
