import type { TenderView } from '@anomaly-detector/contracts'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import {
  fieldTypeLabelKeys,
  polarityLabelKeys,
  signalLabelKeys,
} from '../catalog'

const laboratoryResultLabels: Record<string, string> = {
  transmission_gain: 'Усиление',
  attenuation: 'Ослабление',
  reflection: 'Отражение',
  unstable_collapse: 'Нестабильный срыв',
}

const protocolLabels: Record<string, string> = {
  impulse: 'Импульсный',
  continuous: 'Непрерывный',
}

const verificationLabels: Record<string, string> = {
  standard: 'Стандартная проверка',
  extended: 'Расширенная проверка',
}

const polarityRelationLabels: Record<string, string> = {
  same: 'Одинаковая полярность',
  different: 'Разная полярность',
}

export function TenderPlayers({
  activePlayerId,
  currentUserId,
  players,
}: {
  activePlayerId?: string
  currentUserId?: string
  players: TenderView['players']
}) {
  return (
    <div className="grid gap-3 self-start">
      <Typography variant="control" tone="muted">Игроки</Typography>
      {players
        .slice()
        .sort((left, right) => (left.accessSlot ?? 99) - (right.accessSlot ?? 99))
        .map((player) => (
          <Card
            key={player.playerId}
            size="sm"
            className={player.playerId === currentUserId ? 'ring-2 ring-primary' : ''}
          >
            <CardContent className="grid gap-1 py-3">
              <div className="flex items-center gap-2">
                <Typography variant="bodySmMedium">
                  Слот {player.accessSlot ?? '?'}
                </Typography>
                <Typography variant="control" tone="muted">
                  {player.displayName ?? player.playerId.slice(0, 8)}
                </Typography>
                {player.playerId === activePlayerId && (
                  <Badge variant="outline" className="ml-auto">Действует</Badge>
                )}
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
  )
}

export function TenderEvidence({ view }: { view: TenderView }) {
  const { t } = useI18n()

  return (
    <>
      {view.publicLaboratoryResults.length > 0 && (
        <div className="grid gap-2">
          <Typography variant="control" tone="muted">Публичные результаты лаборатории</Typography>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.publicLaboratoryResults.map((result, index) => (
              <Card key={index} size="sm">
                <CardContent className="py-3">
                  <Typography variant="bodySmMedium">
                    {t(signalLabelKeys[result.sourceSignal])} → {t(signalLabelKeys[result.receiverSignal])}
                  </Typography>
                  <Typography variant="control" tone="muted">
                    {laboratoryResultLabels[result.publicResult] ?? result.publicResult}{' '}
                    ({protocolLabels[result.protocol] ?? result.protocol})
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {view.privateMeasurements.length > 0 && (
        <div className="grid gap-2">
          <Typography variant="control" tone="muted">Ваши приватные измерения</Typography>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.privateMeasurements.map((measurement, index) => (
              <Card key={index} size="sm">
                <CardContent className="py-3">
                  <Typography variant="bodySmMedium">
                    {t(signalLabelKeys[measurement.sourceSignal])} → {t(signalLabelKeys[measurement.receiverSignal])}
                  </Typography>
                  <Typography variant="control" tone="muted">
                    {polarityRelationLabels[measurement.polarityRelation] ?? measurement.polarityRelation}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {view.publicTheses.length > 0 && (
        <div className="grid gap-2">
          <Typography variant="control" tone="muted">Публичные тезисы</Typography>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.publicTheses.map((thesis, index) => (
              <Card key={index} size="sm" className={thesis.correct ? 'border-green-500/50' : 'border-red-500/50'}>
                <CardContent className="py-3">
                  <Typography variant="bodySmMedium">
                    {t(signalLabelKeys[thesis.signalId])}: {t(fieldTypeLabelKeys[thesis.fieldType])} / {t(polarityLabelKeys[thesis.polarity])}
                  </Typography>
                  <Typography variant="control" tone={thesis.correct ? 'default' : 'destructive'}>
                    {thesis.correct ? 'Верно' : 'Неверно'} · {verificationLabels[thesis.verification] ?? thesis.verification}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
