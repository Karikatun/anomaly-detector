import { Logout01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { profileQueryKeys } from '@/features/profile'
import { roomQueryKeys } from '@/features/rooms'
import { LaboratoryInterpretationDialog, RulesReferenceDialog } from '@/features/rules'
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
  TenderLaboratoryJournal,
  TenderPlanningContext,
  TenderPlayers,
  TenderResearchData,
} from './components/TenderOverview'
import { WorkingModelWorkspace } from './components/WorkingModelWorkspace'
import { CompletedTenderPanel } from './components/CompletedTenderPanel'
import { ContractPlanningPanel } from './components/ContractPlanningPanel'
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
  getWaitingForTurnDescription,
} from './tender-command-feedback'
import styles from './TenderPage.module.css'

const phaseLabels: Record<string, string> = {
  'access-slot-selection': '1. Выбор слота доступа',
  'power-allocation': '2. Распределение мощности',
  'reconnaissance': '3. Разведка',
  'laboratory': '4. Лаборатория',
  'model-analysis': '5. Анализ модели',
  'contracts': '6. Контракты',
  'final-scientific-model': '7. Финальная модель',
  'complete': 'Завершён',
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
  finalScientificModelSubmitted,
  phase,
  playerName,
}: {
  finalScientificModelSubmitted?: boolean
  phase: TenderView['phase']
  playerName?: string
}) {
  return (
    <PhaseNotice
      kind="waiting"
      description={getWaitingForTurnDescription(phase, playerName, finalScientificModelSubmitted)}
    >
      Ожидание хода
    </PhaseNotice>
  )
}

function PhasePanel({ view, disabled, error, onCommand, onSaveWorkingModel, activePlayerId }: {
  view: TenderView
  disabled: boolean
  error: string | null
  onCommand: (cmd: TenderCommandInput) => Promise<void>
  onSaveWorkingModel: (workingModel: TenderView['privateWorkingModel']) => Promise<void>
  activePlayerId?: string
}) {
  const auth = useAuth()
  const myPlayer = view.players.find((p) => p.playerId === auth.user?.id)
  const mySamples = myPlayer ? view.privateSamples : []
  const myPower = myPlayer?.powerAllocation
  const activePlayer = view.players.find((player) => player.playerId === activePlayerId)
  const isSharedModelAnalysis = view.phase === 'model-analysis' && view.ruleset === 'tender-v2'
  const isSharedFinalScientificModel = view.phase === 'final-scientific-model'
    && view.ruleset === 'tender-v2'
  const isWaitingForTurn = sequentialPhases.has(view.phase)
    && !isSharedModelAnalysis
    && !isSharedFinalScientificModel
    && activePlayerId !== auth.user?.id
  const withWaitingState = (content: ReactNode) => (
    <>
      {isWaitingForTurn && (
        <WaitingForTurn
          finalScientificModelSubmitted={myPlayer?.finalScientificModelSubmitted}
          phase={view.phase}
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
          disabled={disabled || myPlayer?.requestedAccessSlot !== undefined}
          confirmedSlot={myPlayer?.requestedAccessSlot}
          currentUserId={auth.user?.id}
          error={error}
          onConfirm={(slot) => onCommand({ type: 'request-access-slot', slot })}
          tiePriorityOrder={view.players}
        >
          {view.round > 1 && (
            <TenderPlanningContext samples={mySamples} view={view} />
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
          mySamples={mySamples}
          privateMeasurements={view.privateMeasurements}
          powerAllocation={labPower}
          ruleset={view.ruleset}
          disabled={disabled || isWaitingForTurn}
          error={error}
          onConfirm={(laboratory) => {
            if (view.ruleset === 'tender-v1') {
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
        <UnavailablePhaseCard>Вы не выделили мощность на лабораторию.</UnavailablePhaseCard>
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
          publicLaboratoryResults={view.publicLaboratoryResults}
          privateMeasurements={view.privateMeasurements}
          privateTheses={view.privateTheses}
          progress={view.modelAnalysisProgress}
          round={view.round}
          ruleset={view.ruleset}
          disabled={disabled || isWaitingForTurn || myPlayer?.modelAnalysisCompleted}
          workingModelDisabled={disabled}
          error={error}
          onConfirmThesis={(input) => onCommand({ type: 'submit-thesis', ...input })}
          onFinish={() => onCommand({ type: 'finish-model-analysis' })}
          onSaveWorkingModel={onSaveWorkingModel}
        />,
      ) : (
        <UnavailablePhaseCard>Вы не выделили мощность на анализ модели.</UnavailablePhaseCard>
      )
    }

    case 'contracts': {
      const contractPower = myPower?.contracts ?? 0
      const restriction = myPlayer?.contractPowerRestriction ?? 0
      const effective = Math.max(0, contractPower - restriction)
      return effective > 0 ? withWaitingState(
        <ContractsPanel
          activePlayerId={view.activePlayerId}
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
          onReserve={(contractId) => onCommand({ type: 'reserve-contract', contractId })}
          onSkip={() => onCommand({ type: 'skip-contract' })}
          onBid={(contractId, bid) =>
            onCommand({ type: 'submit-contract-bid', contractId, ...bid })
          }
        />,
      ) : (
        <UnavailablePhaseCard>Нет доступной мощности для контрактов.</UnavailablePhaseCard>
      )
    }

    case 'final-scientific-model': {
      return withWaitingState(
        <FinalScientificModelPanel
          draft={view.privateFinalScientificModelDraft ?? { signals: {} }}
          dueAt={view.dueAt ?? null}
          evidence={{
            privateMeasurements: view.privateMeasurements,
            publicLaboratoryResults: view.publicLaboratoryResults,
            publicTheses: view.publicTheses,
          }}
          disabled={disabled || isWaitingForTurn}
          error={error}
          onConfirm={(scientificModel) => onCommand({ type: 'submit-scientific-model', scientificModel })}
          onSaveDraft={(scientificModelDraft) =>
            onCommand({ type: 'update-scientific-model-draft', scientificModelDraft })
          }
          progress={view.finalScientificModelProgress}
          serverTime={view.serverTime}
          submitted={myPlayer?.finalScientificModelSubmitted}
          workingModel={view.privateWorkingModel}
        />,
      )
    }

    case 'complete':
      return view.audit ? (
        <CompletedTenderPanel view={{ ...view, audit: view.audit }} />
      ) : (
        <Card>
          <CardHeader><CardTitle>Тендер завершён</CardTitle></CardHeader>
          <CardContent><Typography tone="muted">Ожидание данных аудита...</Typography></CardContent>
        </Card>
      )

    default:
      return (
        <Card>
          <CardHeader><CardTitle>{phaseLabels[view.phase] ?? view.phase}</CardTitle></CardHeader>
          <CardContent><Typography tone="muted">Эта фаза в разработке.</Typography></CardContent>
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
  const commandInFlightRef = useRef<{ promise: Promise<void>; token: symbol } | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const primaryContentRef = useRef<HTMLDivElement>(null)
  const latestTenderViewRef = useRef(tenderView)
  const previousActivePlayerIdRef = useRef<string | undefined>(undefined)
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
    const previousActivePlayerId = previousActivePlayerIdRef.current
    previousActivePlayerIdRef.current = activePlayerId
    if (
      !tenderView
      || previousActivePlayerId === undefined
      || previousActivePlayerId === activePlayerId
      || activePlayerId !== auth.user?.id
      || !sequentialPhases.has(tenderView.phase)
    ) return
    requestAnimationFrame(() => {
      setRulesOpen(false)
      setLaboratoryHelpOpen(false)
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
    [auth.user?.id, execute, t],
  )
  const saveWorkingModel = useCallback(
    async (workingModel: TenderView['privateWorkingModel']) => {
      if (!connected) {
        throw new Error('Соединение с игрой потеряно. Подключитесь снова перед сохранением.')
      }
      await execute({
        type: 'update-working-model',
        workingModel,
      })
    },
    [connected, execute],
  )
  const leaveMatch = useCallback(async () => {
    if (tenderView?.phase === 'complete') {
      await navigate({ to: tenderSearch.from === 'matches' ? '/app' : '/' })
      return
    }
    leavingTenderIdRef.current = tenderId
    try {
      await handleCommand({ type: 'leave-tender' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: roomQueryKeys.current() }),
        queryClient.invalidateQueries({ queryKey: roomQueryKeys.mine() }),
      ])
      await navigate({ to: '/' })
    } catch {
      leavingTenderIdRef.current = null
      // The shared command error remains visible; stay in the match so the player can retry.
    }
  }, [handleCommand, navigate, queryClient, tenderId, tenderSearch.from, tenderView?.phase])

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
            {connected ? 'Загрузка тендера...' : 'Подключение...'}
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
  const isSharedModelAnalysis = tenderView.phase === 'model-analysis'
    && tenderView.ruleset === 'tender-v2'
  const isSharedFinalScientificModel = tenderView.phase === 'final-scientific-model'
    && tenderView.ruleset === 'tender-v2'
  const isSharedOperationalPhase = isSharedModelAnalysis || isSharedFinalScientificModel
  const isSequentialPhase = sequentialPhases.has(tenderView.phase) && !isSharedOperationalPhase
  const isMyTurn = !isSequentialPhase || tenderView.activePlayerId === auth.user?.id
  const isAccessSlotSelection = tenderView.phase === 'access-slot-selection'
  const isPowerAllocation = tenderView.phase === 'power-allocation'
  const isLaboratoryPhase = tenderView.phase === 'laboratory'
  const isComplete = tenderView.phase === 'complete'
  const isPlanningPhase = isAccessSlotSelection || isPowerAllocation
  const isOperationalPhase = !isPlanningPhase && !isComplete
  const showRightSidebar = !isPlanningPhase && !isComplete
  const showGenericTools = !isPlanningPhase && tenderView.phase !== 'model-analysis' && !isComplete
  const showContractPlanning = isPowerAllocation || isLaboratoryPhase
  const referenceHelpDisabled = isSequentialPhase && isMyTurn
  const hasPendingAction = isAccessSlotSelection
    ? myPlayer?.requestedAccessSlot === undefined
    : isPowerAllocation
      ? myPlayer?.powerAllocation === undefined
      : isSharedOperationalPhase
        ? isSharedModelAnalysis
          ? !myPlayer?.modelAnalysisCompleted
          : !myPlayer?.finalScientificModelSubmitted
        : isSequentialPhase && isMyTurn
  const referenceHelpUrgentlyLocked = hasPendingAction && remainingSeconds <= 10

  return (
    <section className={`${styles.page} mx-auto w-full min-w-0 max-w-[90rem] overflow-x-clip px-3 py-3 sm:px-5 sm:py-5`}>
      <header
        ref={headerRef}
        aria-label={t('tender.phase.status')}
        className={`${styles.header} sticky top-0 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:px-5 sm:py-3`}
      >
        <div className="grid min-w-0 gap-0.5">
          <Typography variant="shortcut" tone="muted" className="uppercase">
            Раунд {tenderView.round} / 5
          </Typography>
          <Typography as="h3" variant="bodySmMedium" className="truncate">{phase}</Typography>
        </div>
        <div className="justify-self-end">
          <TenderTimer dueAt={tenderView.dueAt} serverTime={tenderView.serverTime} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {mySlot && <Badge variant="outline">Слот {mySlot}</Badge>}
          {isAccessSlotSelection && (
            <Badge variant="outline">Бюджет: {myPlayer?.budget ?? 0} M</Badge>
          )}
          {isSequentialPhase && (
            <Badge variant={isMyTurn ? 'default' : 'outline'}>
              {isMyTurn ? 'Ваш ход' : `Ход: ${activePlayer?.displayName ?? 'игрока'}`}
            </Badge>
          )}
          {isSharedModelAnalysis && tenderView.modelAnalysisProgress && (
            <Badge variant="outline">
              {t('tender.analysis.progress', {
                completed: tenderView.modelAnalysisProgress.completed,
                total: tenderView.modelAnalysisProgress.total,
              })}
            </Badge>
          )}
          {isSharedFinalScientificModel && tenderView.finalScientificModelProgress && (
            <Badge variant="outline">
              {t('tender.finalDraft.progress', {
                completed: tenderView.finalScientificModelProgress.completed,
                total: tenderView.finalScientificModelProgress.total,
              })}
            </Badge>
          )}
        </div>
        <div className={`${styles.headerActions} flex items-center justify-self-end gap-1`}>
          {connected ? (
            <Badge variant="outline" className={`${styles.connectionBadge} text-emerald-400`}>{t('tender.realtime.live')}</Badge>
          ) : (
            <Badge variant="outline" className={`${styles.connectionBadge} text-amber-400`}>{t('tender.realtime.reconnecting')}</Badge>
          )}
          <RulesReferenceDialog
            belowTenderHeader
            disabled={referenceHelpDisabled || referenceHelpUrgentlyLocked}
            onOpenChange={setRulesOpen}
            open={rulesOpen && !referenceHelpUrgentlyLocked}
            showTimerWarning
            ruleset={tenderView.ruleset}
            triggerClassName={styles.rulesAction}
            triggerIcon="book"
            triggerTextClassName={styles.headerActionLabel}
          />
          <LaboratoryInterpretationDialog
            belowTenderHeader
            disabled={referenceHelpDisabled || referenceHelpUrgentlyLocked}
            onOpenChange={setLaboratoryHelpOpen}
            open={laboratoryHelpOpen && !referenceHelpUrgentlyLocked}
            showTimerWarning
            triggerClassName={styles.laboratoryAction}
            triggerTextClassName={styles.headerActionLabel}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={styles.leaveAction}
            aria-label={t('nav.leaveMatch')}
            title={t('nav.leaveMatch')}
            disabled={submitting || resuming || tenderView.hasLeft}
            onClick={() => void leaveMatch()}
          >
            <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.7} aria-hidden="true" />
            <Typography as="span" variant="control">{t('button.logout')}</Typography>
          </Button>
        </div>
      </header>

      <div className={styles.content}>
        {!connected && (
          <ReconnectOverlay
            errorText={error ? t(realtimeErrorKeys[error]) : undefined}
            onRetry={retry}
          />
        )}

        <TenderPhaseLayout
          progress={isOperationalPhase
            ? <TenderPhaseProgress phase={tenderView.phase} />
            : undefined}
          mobilePlayers={isOperationalPhase
            ? (
                <TenderPlayers
                  activePlayerId={tenderView.activePlayerId}
                  compact
                  currentUserId={auth.user?.id}
                  players={tenderView.players}
                />
              )
            : undefined}
          primary={(
            <div
              ref={primaryContentRef}
              tabIndex={-1}
              className="grid min-w-0 self-start gap-4 outline-none"
            >
            <PhasePanel
              view={tenderView}
              disabled={submitting || !connected}
              error={visibleCommandError}
              onCommand={handleCommand}
              onSaveWorkingModel={saveWorkingModel}
              activePlayerId={tenderView.activePlayerId}
            />

            {isLaboratoryPhase && (
              <div className="min-[64rem]:hidden">
                <TenderLaboratoryJournal
                  players={tenderView.players}
                  results={tenderView.publicLaboratoryResults}
                />
              </div>
            )}
            </div>
          )}
          supporting={showGenericTools || showContractPlanning
            ? (
                <>
                  {showContractPlanning && <ContractPlanningPanel view={tenderView} />}
                  {showGenericTools && (
                    <>
                  <WorkingModelWorkspace
                    disabled={!connected}
                    inlineOnDesktop
                    knownSignals={tenderView.knownSignals}
                    model={tenderView.privateWorkingModel}
                    onSave={saveWorkingModel}
                  />
                  <TenderResearchData view={tenderView} />
                    </>
                  )}
                </>
              )
            : undefined}
          sidebar={showRightSidebar
            ? (
              <>
              <TenderPlayers
                activePlayerId={tenderView.activePlayerId}
                currentUserId={auth.user?.id}
                players={tenderView.players}
              />
              {isLaboratoryPhase && (
                <TenderLaboratoryJournal
                  players={tenderView.players}
                  results={tenderView.publicLaboratoryResults}
                />
              )}
              {tenderView.phase === 'model-analysis' && <TenderResearchData view={tenderView} />}
              </>
            )
            : undefined}
        />
      </div>
    </section>
  )
}
