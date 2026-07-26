import { Logout01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { profileQueryKeys } from '@/features/profile'
import { RulesReferenceDialog } from '@/features/rules'
import { useI18n } from '@/platform/i18n'
import type { TranslationKey } from '@/platform/i18n/translations'
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
import {
  TenderLaboratoryJournal,
  TenderPlayers,
  TenderResearchData,
} from './components/TenderOverview'
import { WorkingModelWorkspace } from './components/WorkingModelWorkspace'
import {
  fieldTypeLabelKeys,
  isSignalId,
  polarityLabelKeys,
  signalLabelKeys,
} from './catalog'
import {
  useTenderCommands,
  type TenderCommandInput,
} from './commands'
import {
  useRealtimeTender,
  type RealtimeErrorCode,
} from './realtime'

const phaseLabels: Record<string, string> = {
  'access-slot-selection': '1. Выбор слота доступа',
  'power-allocation': '2. Распределение мощности',
  'reconnaissance': '3. Разведка',
  'laboratory': '4. Лаборатория',
  'model-analysis': '5. Анализ модели',
  'contracts': '6. Контракты',
  'final-scientific-model': '7. Финальная научная модель',
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

function WaitingForTurn({ playerName }: { playerName?: string }) {
  return (
    <PhaseNotice
      kind="waiting"
      description={playerName
        ? `Сейчас действует ${playerName}. Форма откроется в ваш слот.`
        : 'Ожидаем синхронизацию следующего хода.'}
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
  const { t } = useI18n()
  const myPlayer = view.players.find((p) => p.playerId === auth.user?.id)
  const mySamples = myPlayer ? view.privateSamples : []
  const myPower = myPlayer?.powerAllocation
  const activePlayer = view.players.find((player) => player.playerId === activePlayerId)
  const isWaitingForTurn = sequentialPhases.has(view.phase) && activePlayerId !== auth.user?.id
  const withWaitingState = (content: ReactNode) => (
    <>
      {isWaitingForTurn && <WaitingForTurn playerName={activePlayer?.displayName} />}
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
        />
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
          disabled={disabled || isWaitingForTurn}
          error={error}
          onConfirm={(input) => onCommand({ type: 'run-laboratory-test', ...input })}
        />,
      ) : (
        <UnavailablePhaseCard>Вы не выделили мощность на лабораторию.</UnavailablePhaseCard>
      )
    }

    case 'model-analysis': {
      const maPower = myPower?.modelAnalysis ?? 0
      return maPower > 0 ? withWaitingState(
        <ModelAnalysisPanel
          dueAt={view.dueAt}
          knownSignals={view.knownSignals}
          maxTheses={maPower}
          model={view.privateWorkingModel}
          publicTheses={view.publicTheses}
          publicLaboratoryResults={view.publicLaboratoryResults}
          privateMeasurements={view.privateMeasurements}
          serverTime={view.serverTime}
          disabled={disabled || isWaitingForTurn}
          workingModelDisabled={disabled}
          error={error}
          onConfirmThesis={(input) => onCommand({ type: 'submit-thesis', ...input })}
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
          round={view.round}
          disabled={disabled || isWaitingForTurn}
          error={error}
          onReserve={(contractId) => onCommand({ type: 'reserve-contract', contractId })}
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
          disabled={disabled || isWaitingForTurn}
          error={error}
          onConfirm={(scientificModel) => onCommand({ type: 'submit-scientific-model', scientificModel })}
        />,
      )
    }

    case 'complete':
      return view.audit ? (
        <Card>
          <CardHeader>
            <CardTitle>Тендер завершён</CardTitle>
            <CardDescription>
              Победитель{view.winnerPlayerIds && view.winnerPlayerIds.length > 1 ? 'и' : ''}:{' '}
              {view.winnerPlayerIds
                ?.map((playerId) => view.players.find((player) => player.playerId === playerId)?.displayName ?? playerId.slice(0, 8))
                .join(', ') ?? '—'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Typography variant="bodySm" tone="muted">
              Аномалия раскрыта. Ниже — полная конфигурация и журнал событий.
            </Typography>
            <div className="mt-4 grid gap-2">
              <Typography variant="control" tone="muted">Свойства сигналов</Typography>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(view.audit.anomalyConfiguration.signals).map(([sig, props]) => (
                    <Card key={sig} size="sm">
                      <CardContent className="py-3">
                        <Typography variant="bodySmMedium">
                        {isSignalId(sig) ? t(signalLabelKeys[sig]) : sig}
                      </Typography>
                      <Typography variant="bodySmSnug" tone="muted">
                        {t(fieldTypeLabelKeys[props.fieldType])} / {t(polarityLabelKeys[props.polarity])}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <Typography variant="control" tone="muted">Итоговый рейтинг</Typography>
              {view.players.map((p) => (
                <div key={p.playerId} className="grid gap-2 rounded-lg border p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center">
                  <Typography variant="bodySmMedium">Слот {p.accessSlot}</Typography>
                  <Typography variant="bodySm" tone="muted" className="min-w-0 break-words">
                    {p.displayName ?? p.playerId.slice(0, 8)}
                  </Typography>
                  <Typography variant="bodySmMedium">
                    Рейтинг: {p.rating} · Бюджет: {p.budget}
                  </Typography>
                  {view.winnerPlayerIds?.includes(p.playerId) && (
                    <Badge variant="outline" className="justify-self-start sm:justify-self-auto">Победитель</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
  const queryClient = useQueryClient()

  const { connected, error, retry, tenderView } = useRealtimeTender(auth.transport, tenderId)
  const { execute } = useTenderCommands(auth.transport, tenderId, auth.user?.id ?? '')
  const [commandError, setCommandError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (tenderView?.phase !== 'complete') return
    void queryClient.invalidateQueries({
      exact: true,
      queryKey: profileQueryKeys.statistics(),
    })
  }, [queryClient, tenderView?.phase, tenderId])

  const handleCommand = useCallback(
    async (command: TenderCommandInput) => {
      setCommandError(null)
      setSubmitting(true)
      try {
        await execute(command)
      } catch (err) {
        setCommandError(err instanceof Error ? err.message : 'Command failed')
        throw err
      } finally {
        setSubmitting(false)
      }
    },
    [execute],
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

  if (error && !tenderView) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Typography variant="h4" tone="destructive">{t(realtimeErrorKeys[error])}</Typography>
      </section>
    )
  }

  if (!tenderView) {
    return (
      <section className="mx-auto flex w-full max-w-6xl items-center justify-center px-5 py-16">
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
  const myPlayer = tenderView.players.find((p) => p.playerId === auth.user?.id)
  const mySlot = myPlayer?.accessSlot
  const activePlayer = tenderView.players.find((player) => player.playerId === tenderView.activePlayerId)
  const isSequentialPhase = sequentialPhases.has(tenderView.phase)
  const isMyTurn = !isSequentialPhase || tenderView.activePlayerId === auth.user?.id
  const isAccessSlotSelection = tenderView.phase === 'access-slot-selection'
  const isPowerAllocation = tenderView.phase === 'power-allocation'
  const isLaboratoryPhase = tenderView.phase === 'laboratory'
  const isPlanningPhase = isAccessSlotSelection || isPowerAllocation
  const isEmbeddedWorkspacePhase = tenderView.phase === 'model-analysis'
    || tenderView.phase === 'contracts'
    || tenderView.phase === 'final-scientific-model'
  const showRightSidebar = !isPlanningPhase && !isEmbeddedWorkspacePhase
  const showGenericTools = !isPlanningPhase && !isLaboratoryPhase && !isEmbeddedWorkspacePhase

  return (
    <section className="mx-auto grid w-full min-w-0 max-w-[90rem] gap-4 overflow-x-clip px-3 py-3 sm:px-5 sm:py-5">
      <header
        aria-label={t('tender.phase.status')}
        className="sticky top-0 z-20 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:px-5 sm:py-3"
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
        </div>
        <div className="flex items-center justify-self-end gap-1">
          {connected ? (
            <Badge variant="outline" className="text-emerald-400">{t('tender.realtime.live')}</Badge>
          ) : (
            <Badge variant="outline" className="text-amber-400">{t('tender.realtime.reconnecting')}</Badge>
          )}
          <RulesReferenceDialog
            triggerIconOnly
            triggerClassName="border-border/70 bg-input/20"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t('nav.leaveMatch')}
            title={t('nav.leaveMatch')}
            onClick={() => void navigate({ to: '/' })}
          >
            <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.7} aria-hidden="true" />
          </Button>
        </div>
      </header>

      {!connected && (
        <ReconnectOverlay
          errorText={error ? t(realtimeErrorKeys[error]) : undefined}
          onRetry={retry}
        />
      )}

      {isSequentialPhase && tenderView.phase !== 'complete' && (
        <TenderPhaseProgress phase={tenderView.phase} />
      )}

      {isSequentialPhase && (
        <div className="lg:hidden">
          <TenderPlayers
            activePlayerId={tenderView.activePlayerId}
            compact
            currentUserId={auth.user?.id}
            players={tenderView.players}
          />
        </div>
      )}

      <div className={showRightSidebar ? 'grid min-w-0 items-start gap-6 lg:grid-cols-[1fr_320px]' : 'grid min-w-0 items-start gap-4'}>
        <div className={isPlanningPhase ? 'grid min-w-0 self-start gap-4' : 'grid min-w-0 self-start gap-6'}>
          <PhasePanel
            view={tenderView}
            disabled={submitting || !connected}
            error={commandError}
            onCommand={handleCommand}
            onSaveWorkingModel={saveWorkingModel}
            activePlayerId={tenderView.activePlayerId}
          />

          {isLaboratoryPhase && (
            <div className="lg:hidden">
              <TenderLaboratoryJournal
                players={tenderView.players}
                results={tenderView.publicLaboratoryResults}
              />
            </div>
          )}

          {showGenericTools && (
            <div className="grid gap-2">
              <TenderResearchData view={tenderView} />

              <WorkingModelWorkspace
                disabled={!connected}
                dueAt={tenderView.dueAt}
                knownSignals={tenderView.knownSignals}
                model={tenderView.privateWorkingModel}
                onSave={saveWorkingModel}
                serverTime={tenderView.serverTime}
              />
            </div>
          )}

          {(tenderView.phase === 'model-analysis' || tenderView.phase === 'final-scientific-model') && (
            <div className="hidden lg:block">
              <TenderPlayers
                activePlayerId={tenderView.activePlayerId}
                compact
                currentUserId={auth.user?.id}
                players={tenderView.players}
              />
            </div>
          )}
        </div>

        {showRightSidebar && (
          <aside className="hidden self-start gap-4 lg:grid">
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
          </aside>
        )}
      </div>

    </section>
  )
}
