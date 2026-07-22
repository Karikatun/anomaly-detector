import { useParams, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { AccessSlotPanel } from './AccessSlotPanel'
import { ContractsPanel } from './ContractsPanel'
import { FinalScientificModelPanel } from './FinalScientificModelPanel'
import { LaboratoryPanel } from './LaboratoryPanel'
import { ModelAnalysisPanel } from './ModelAnalysisPanel'
import { PowerAllocationPanel } from './PowerAllocationPanel'
import { ReconnaissancePanel } from './ReconnaissancePanel'
import { TenderTimer } from './TenderTimer'
import { WorkingModelPanel } from './WorkingModelPanel'
import { useRealtimeTender } from './realtime'
import { useTenderCommands } from './commands'

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

function PhasePanel({ view, disabled, error, onCommand }: {
  view: TenderView
  disabled: boolean
  error: string | null
  onCommand: (cmd: Record<string, unknown> & { type: string }) => void
}) {
  const auth = useAuth()
  const myPlayer = view.players.find((p) => p.playerId === auth.user?.id)
  const mySamples = myPlayer ? view.privateSamples : []
  const myPower = myPlayer?.powerAllocation

  switch (view.phase) {
    case 'access-slot-selection':
      return (
        <AccessSlotPanel
          disabled={disabled || myPlayer?.requestedAccessSlot !== undefined}
          error={error}
          onConfirm={(slot) => onCommand({ type: 'request-access-slot', slot })}
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
          onConfirm={(signals) => onCommand({ type: 'conduct-reconnaissance', signals })}
        />
      ) : (
        <Card><CardContent className="py-8"><Typography tone="muted">Вы не выделили мощность на разведку.</Typography></CardContent></Card>
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
        <Card><CardContent className="py-8"><Typography tone="muted">Вы не выделили мощность на лабораторию.</Typography></CardContent></Card>
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
        <Card><CardContent className="py-8"><Typography tone="muted">Вы не выделили мощность на анализ модели.</Typography></CardContent></Card>
      )
    }

    case 'contracts': {
      const contractPower = myPower?.contracts ?? 0
      const restriction = myPlayer?.contractPowerRestriction ?? 0
      const effective = Math.max(0, contractPower - restriction)
      return effective > 0 ? (
        <ContractsPanel
          contracts={view.publicContracts}
          maxPower={effective}
          disabled={disabled}
          error={error}
          onReserve={(contractId) => onCommand({ type: 'reserve-contract', contractId })}
          onBid={(contractId, claimedPublicResult, requestedFunding) =>
            onCommand({ type: 'submit-contract-bid', contractId, claimedPublicResult, requestedFunding })
          }
        />
      ) : (
        <Card><CardContent className="py-8"><Typography tone="muted">Нет доступной мощности для контрактов.</Typography></CardContent></Card>
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
              {view.winnerPlayerIds?.join(', ') ?? '—'}
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
                      <Typography variant="bodySm" className="font-bold">
                        {sig}
                      </Typography>
                      <Typography variant="control" tone="muted">
                        {props.fieldType} / {props.polarity}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <Typography variant="control" tone="muted">Итоговый рейтинг</Typography>
              {view.players.map((p) => (
                <div key={p.playerId} className="flex items-center gap-2 rounded-lg border p-3">
                  <Typography variant="bodySm" className="font-medium">Слот {p.accessSlot}</Typography>
                  <Typography variant="control" tone="muted">
                    {p.playerId.slice(0, 8)}
                  </Typography>
                  <Typography variant="bodySm" className="ml-auto font-bold">
                    Рейтинг: {p.rating} · Бюджет: {p.budget}
                  </Typography>
                  {view.winnerPlayerIds?.includes(p.playerId) && (
                    <Badge variant="outline">Победитель</Badge>
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
  const { tenderId } = useParams({ strict: false }) as { tenderId: string }
  const auth = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.user, navigate])

  const { connected, error, tenderView } = useRealtimeTender(auth.transport, tenderId)
  const { execute } = useTenderCommands(auth.transport, tenderId)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleCommand = useCallback(
    async (command: Record<string, unknown> & { type: string }) => {
      setCommandError(null)
      setSubmitting(true)
      try {
        await execute({
          ...command,
          actorId: auth.user!.id,
        } as Parameters<typeof execute>[0])
      } catch (err) {
        setCommandError(err instanceof Error ? err.message : 'Command failed')
      } finally {
        setSubmitting(false)
      }
    },
    [execute, auth.user],
  )

  if (error && !tenderView) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Typography variant="h4" tone="destructive">{error}</Typography>
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

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="tracking-widest uppercase">Раунд {tenderView.round} / 5</Badge>
        <Typography variant="h3">{phase}</Typography>
        <TenderTimer dueAt={tenderView.dueAt} />
        {mySlot && <Badge variant="outline">Слот {mySlot}</Badge>}
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: '/rooms' })}
          >
            Выйти
          </Button>
          {connected ? (
            <Badge variant="outline">Live</Badge>
          ) : (
            <Badge variant="outline" className="text-amber-400">Reconnecting...</Badge>
          )}
        </div>
      </div>

      {/* Phase panel + right sidebar */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-6">
          <PhasePanel
            view={tenderView}
            disabled={submitting}
            error={commandError}
            onCommand={handleCommand}
          />
        </div>

        {/* Right sidebar: players */}
        <div className="grid gap-3 self-start">
          <Typography variant="control" tone="muted">Игроки</Typography>
          {tenderView.players
            .slice()
            .sort((a, b) => (a.accessSlot ?? 99) - (b.accessSlot ?? 99))
            .map((player) => (
              <Card
                key={player.playerId}
                size="sm"
                className={player.playerId === auth.user?.id ? 'ring-2 ring-primary' : ''}
              >
                <CardContent className="grid gap-1 py-3">
                  <div className="flex items-center gap-2">
                    <Typography variant="bodySm" className="font-medium">
                      Слот {player.accessSlot ?? '?'}
                    </Typography>
                    <Typography variant="control" tone="muted">
                      {player.displayName ?? player.playerId.slice(0, 8)}
                    </Typography>
                  </div>
                  <Typography variant="control" tone="muted">
                    Рейтинг: {player.rating} · Бюджет: {player.budget}
                  </Typography>
                  {player.powerAllocation && (
                    <Typography variant="control" tone="muted">
                      Р: {player.powerAllocation.reconnaissance}{' '}
                      Л: {player.powerAllocation.laboratory}{' '}
                      М: {player.powerAllocation.modelAnalysis}{' '}
                      К: {player.powerAllocation.contracts}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      <Separator />

      {/* Public lab results */}
      {tenderView.publicLaboratoryResults.length > 0 && (
        <div className="grid gap-2">
          <Typography variant="control" tone="muted">Результаты лаборатории</Typography>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tenderView.publicLaboratoryResults.map((r, i) => (
              <Card key={i} size="sm">
                <CardContent className="py-3">
                  <Typography variant="bodySm" className="font-medium">
                    {r.sourceSignal} → {r.receiverSignal}
                  </Typography>
                  <Typography variant="control" tone="muted">
                    {r.publicResult} ({r.protocol})
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Public theses */}
      {tenderView.publicTheses.length > 0 && (
        <div className="grid gap-2">
          <Typography variant="control" tone="muted">Публичные тезисы</Typography>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tenderView.publicTheses.map((thesis, i) => (
              <Card key={i} size="sm" className={thesis.correct ? 'border-green-500/50' : 'border-red-500/50'}>
                <CardContent className="py-3">
                  <Typography variant="bodySm" className="font-medium">
                    {thesis.signalId}: {thesis.fieldType} / {thesis.polarity}
                  </Typography>
                  <Typography variant="control" tone={thesis.correct ? 'default' : 'destructive'}>
                    {thesis.correct ? 'Верно' : 'Неверно'} · {thesis.verification}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Working Model */}
      <Separator />
      <details open className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">
          <span className="flex items-center gap-3">
            <img src="/assets/icons.webp" alt="" className="h-8 w-12 rounded object-cover opacity-70" />
            Рабочая модель
          </span>
        </summary>
        <div className="mt-4">
          <WorkingModelPanel
            model={tenderView.privateWorkingModel}
            knownSignals={tenderView.knownSignals}
            onSave={(wm) => handleCommand({ type: 'update-working-model', workingModel: wm })}
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

      {/* Debug panel */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-muted-foreground">Debug: TenderView JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-muted/50 p-4 text-xs">
          {JSON.stringify(tenderView, null, 2)}
        </pre>
      </details>
    </section>
  )
}
