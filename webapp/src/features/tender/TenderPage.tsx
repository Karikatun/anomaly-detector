import { useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { profileQueryKeys } from '@/features/profile'
import { useI18n } from '@/platform/i18n'
import type { TranslationKey } from '@/platform/i18n/translations'
import { AccessSlotPanel } from './AccessSlotPanel'
import { ContractsPanel } from './ContractsPanel'
import { FinalScientificModelPanel } from './FinalScientificModelPanel'
import { LaboratoryPanel } from './LaboratoryPanel'
import { ModelAnalysisPanel } from './ModelAnalysisPanel'
import { PowerAllocationPanel } from './PowerAllocationPanel'
import { ReconnaissancePanel } from './ReconnaissancePanel'
import { TenderTimer } from './TenderTimer'
import { WorkingModelPanel } from './WorkingModelPanel'
import { UnavailablePhaseCard } from './components/TenderActionPanel'
import { TenderPlayers, TenderPublicEvidence } from './components/TenderOverview'
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
    <Card>
      <CardHeader>
        <CardTitle>Ожидание хода</CardTitle>
        <CardDescription>
          {playerName
            ? `Сейчас действует ${playerName}. Ваша форма откроется, когда подойдёт ваш слот.`
            : 'Сервер обрабатывает переход фазы. Ваша форма откроется после синхронизации.'}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function PhasePanel({ view, disabled, error, onCommand, activePlayerId }: {
  view: TenderView
  disabled: boolean
  error: string | null
  onCommand: (cmd: TenderCommandInput) => Promise<void>
  activePlayerId?: string
}) {
  const auth = useAuth()
  const { t } = useI18n()
  const myPlayer = view.players.find((p) => p.playerId === auth.user?.id)
  const mySamples = myPlayer ? view.privateSamples : []
  const myPower = myPlayer?.powerAllocation
  const activePlayer = view.players.find((player) => player.playerId === activePlayerId)

  if (sequentialPhases.has(view.phase) && activePlayerId !== auth.user?.id) {
    return <WaitingForTurn playerName={activePlayer?.displayName} />
  }

  switch (view.phase) {
    case 'access-slot-selection':
      return (
        <AccessSlotPanel
          disabled={disabled || myPlayer?.requestedAccessSlot !== undefined}
          confirmedSlot={myPlayer?.requestedAccessSlot}
          error={error}
          onConfirm={(slot) => onCommand({ type: 'request-access-slot', slot })}
          tiePriorityOrder={view.players}
        />
      )

    case 'power-allocation':
      return (
        <PowerAllocationPanel
          disabled={disabled || myPlayer?.powerAllocation !== undefined}
          error={error}
          onConfirm={(allocation) => onCommand({ type: 'allocate-power', allocation })}
        />
      )

    case 'reconnaissance': {
      const reconPower = myPower?.reconnaissance ?? 0
      return reconPower > 0 ? (
        <ReconnaissancePanel
          knownSignals={view.knownSignals}
          mySamples={mySamples}
          maxSignals={reconPower}
          disabled={disabled}
          error={error}
          onConfirm={(targets) => onCommand({ type: 'conduct-reconnaissance', targets })}
        />
      ) : (
        <UnavailablePhaseCard>Вы не выделили мощность на разведку.</UnavailablePhaseCard>
      )
    }

    case 'laboratory': {
      const labPower = myPower?.laboratory ?? 0
      return labPower > 0 ? (
        <LaboratoryPanel
          mySamples={mySamples}
          powerAllocation={labPower}
          disabled={disabled}
          error={error}
          onConfirm={(input) => onCommand({ type: 'run-laboratory-test', ...input })}
        />
      ) : (
        <UnavailablePhaseCard>Вы не выделили мощность на лабораторию.</UnavailablePhaseCard>
      )
    }

    case 'model-analysis': {
      const maPower = myPower?.modelAnalysis ?? 0
      return maPower > 0 ? (
        <ModelAnalysisPanel
          knownSignals={view.knownSignals}
          maxTheses={maPower}
          disabled={disabled}
          error={error}
          onConfirmThesis={(input) => onCommand({ type: 'submit-thesis', ...input })}
        />
      ) : (
        <UnavailablePhaseCard>Вы не выделили мощность на анализ модели.</UnavailablePhaseCard>
      )
    }

    case 'contracts': {
      const contractPower = myPower?.contracts ?? 0
      const restriction = myPlayer?.contractPowerRestriction ?? 0
      const effective = Math.max(0, contractPower - restriction)
      return effective > 0 ? (
        <ContractsPanel
          certifications={view.privateResearchCertifications ?? []}
          contracts={[...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]}
          journal={view.publicScientificJournal ?? []}
          maxPower={effective}
          playerId={auth.user?.id ?? ''}
          round={view.round}
          disabled={disabled}
          error={error}
          onReserve={(contractId) => onCommand({ type: 'reserve-contract', contractId })}
          onBid={(contractId, bid) =>
            onCommand({ type: 'submit-contract-bid', contractId, ...bid })
          }
        />
      ) : (
        <UnavailablePhaseCard>Нет доступной мощности для контрактов.</UnavailablePhaseCard>
      )
    }

    case 'final-scientific-model': {
      return (
        <FinalScientificModelPanel
          disabled={disabled}
          error={error}
          onConfirm={(scientificModel) => onCommand({ type: 'submit-scientific-model', scientificModel })}
        />
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
  const accessSlotWasDisplaced = myPlayer?.requestedAccessSlot !== undefined
    && myPlayer.accessSlot !== undefined
    && myPlayer.requestedAccessSlot !== myPlayer.accessSlot

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8">
      <header
        aria-label={t('tender.phase.status')}
        className="sticky top-0 z-20 -mx-5 grid gap-3 border-y bg-background/95 px-5 py-3 shadow-sm backdrop-blur"
      >
        <Typography variant="h3">{phase}</Typography>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">
            <Typography variant="shortcut" className="uppercase">Раунд {tenderView.round} / 5</Typography>
          </Badge>
          <TenderTimer dueAt={tenderView.dueAt} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {mySlot && <Badge variant="outline">Слот {mySlot}</Badge>}
          {isSequentialPhase && (
            <Badge variant={isMyTurn ? 'default' : 'outline'}>
              {isMyTurn ? 'Ваш ход' : `Ход: ${activePlayer?.displayName ?? 'игрока'}`}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-3">
            {connected ? (
              <Badge variant="outline">{t('tender.realtime.live')}</Badge>
            ) : (
              <Badge variant="outline" className="text-amber-400">{t('tender.realtime.reconnecting')}</Badge>
            )}
          </div>
        </div>
      </header>

      {myPlayer?.requestedAccessSlot !== undefined && myPlayer.accessSlot !== undefined && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('tender.access.result.title')}</CardTitle>
            <CardDescription>
              {accessSlotWasDisplaced
                ? t('tender.access.result.displaced', {
                    requested: myPlayer.requestedAccessSlot,
                    assigned: myPlayer.accessSlot,
                  })
                : t('tender.access.result.same', { slot: myPlayer.accessSlot })}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!connected && (
        <Card size="sm">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <Typography role="alert" variant="bodySm" tone="destructive">
              Данные игры могут быть устаревшими. Действия приостановлены до восстановления realtime-соединения.
              {error ? ` ${t(realtimeErrorKeys[error])}` : ''}
            </Typography>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Подключиться снова
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Phase panel + right sidebar */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-6">
          <PhasePanel
            view={tenderView}
            disabled={submitting || !connected}
            error={commandError}
            onCommand={handleCommand}
            activePlayerId={tenderView.activePlayerId}
          />
        </div>

        <TenderPlayers
          activePlayerId={tenderView.activePlayerId}
          currentUserId={auth.user?.id}
          players={tenderView.players}
        />
      </div>

      <Separator />
      <TenderPublicEvidence view={tenderView} />

      {/* Working Model */}
      <Separator />
      <details open className="mt-4">
        <summary className="cursor-pointer">
          <span className="flex items-center gap-3">
            <img src="/assets/icons.webp" alt="" className="h-8 w-12 rounded object-cover opacity-70" />
            <Typography as="span" variant="bodySmMedium">Рабочая модель</Typography>
          </span>
        </summary>
        <div className="mt-4">
          <WorkingModelPanel
            key={tenderId}
            model={tenderView.privateWorkingModel}
            knownSignals={tenderView.knownSignals}
            disabled={!connected}
            onSave={saveWorkingModel}
          />
        </div>
      </details>

      {/* Anomaly visual */}
      <Separator />
      <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-lg">
        <img
          src="/assets/anomaly-display.webp"
          alt="Аномалия"
          className="w-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent" />
      </div>

    </section>
  )
}
