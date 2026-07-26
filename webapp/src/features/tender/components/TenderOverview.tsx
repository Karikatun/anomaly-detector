import type { CSSProperties } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Card, CardContent } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import {
  fieldTypeLabelKeys,
  polarityLabelKeys,
  signalLabelKeys,
} from '../catalog'
import { SignalGlyph } from './SignalGlyph'
import styles from './TenderOverview.module.css'

const playerAccents = ['#36b8ff', '#f4a51c', '#b767ec', '#68d47a', '#ff665f', '#35d2d8']

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
  const orderedPlayers = players
    .slice()
    .sort((left, right) => (left.accessSlot ?? 99) - (right.accessSlot ?? 99))

  return (
    <section className={styles.playersPanel} aria-labelledby="tender-players-heading">
      <Typography id="tender-players-heading" as="h2" variant="control" className={styles.playersTitle}>
        Игроки
      </Typography>
      <div className={styles.playerList}>
        {orderedPlayers.map((player, index) => {
          const isCurrent = player.playerId === currentUserId
          const isActive = player.playerId === activePlayerId
          const accentIndex = ((player.accessSlot ?? index + 1) - 1) % playerAccents.length
          const playerName = player.displayName ?? player.playerId.slice(0, 8)
          return (
            <div
              key={player.playerId}
              className={styles.playerRow}
              data-active={isActive || undefined}
              style={{ '--player-accent': playerAccents[accentIndex] } as CSSProperties}
            >
              <span className={styles.playerDot} aria-hidden="true" />
              <Typography as="span" variant="bodySm" className={styles.playerName}>
                {isCurrent ? `Вы · ${playerName}` : playerName}
              </Typography>
              <Typography as="span" variant="caption" className={styles.playerStatus}>
                {isActive ? 'активен' : 'ожидает'}
              </Typography>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function TenderLaboratoryJournal({
  players,
  results,
}: {
  players: TenderView['players']
  results: TenderView['publicLaboratoryResults']
}) {
  const { t } = useI18n()
  const latest = results.at(-1)
  const playerName = latest
    ? players.find((player) => player.playerId === latest.playerId)?.displayName
    : undefined

  return (
    <section className={styles.journalPanel} aria-labelledby="laboratory-journal-heading">
      <div className={styles.journalHeader}>
        <Typography id="laboratory-journal-heading" as="h2" variant="control" className={styles.playersTitle}>
          Публичный журнал
        </Typography>
        <Typography as="span" variant="caption" tone="muted">Видят все</Typography>
      </div>

      {latest ? (
        <div className={styles.latestResult}>
          <SignalGlyph signal={latest.sourceSignal} className={styles.journalGlyph} />
          <span className={styles.latestResultCopy}>
            <Typography as="strong" variant="bodySmMedium">
              {`${t(signalLabelKeys[latest.sourceSignal])} → ${t(signalLabelKeys[latest.receiverSignal])}: ${laboratoryResultLabels[latest.publicResult] ?? latest.publicResult}`}
            </Typography>
            <Typography as="span" variant="caption" tone="muted">
              {`${protocolLabels[latest.protocol] ?? latest.protocol} · ${playerName ?? 'Игрок'}`}
            </Typography>
          </span>
        </div>
      ) : (
        <Typography variant="bodySm" tone="muted">
          Результаты появятся после первого проведённого опыта.
        </Typography>
      )}

      {results.length > 0 && (
        <details className={styles.journalHistory}>
          <summary>
            <Typography as="span" variant="bodySmMedium">История журнала</Typography>
            <Typography as="span" variant="caption">{results.length}</Typography>
          </summary>
          <div className={styles.journalHistoryList}>
            {results.slice().reverse().map((result, index) => (
              <Typography key={`${result.playerId}-${index}`} variant="caption" tone="muted">
                {`${t(signalLabelKeys[result.sourceSignal])} → ${t(signalLabelKeys[result.receiverSignal])}: ${laboratoryResultLabels[result.publicResult] ?? result.publicResult}`}
              </Typography>
            ))}
          </div>
        </details>
      )}
    </section>
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
