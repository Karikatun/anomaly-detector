import type { CSSProperties } from 'react'

import type { SignalId, TenderView } from '@anomaly-detector/contracts'

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
  compact = false,
  currentUserId,
  phase,
  players,
}: {
  activePlayerId?: string
  compact?: boolean
  currentUserId?: string
  phase?: TenderView['phase']
  players: TenderView['players']
}) {
  const orderedPlayers = players
    .slice()
    .sort((left, right) => (left.accessSlot ?? 99) - (right.accessSlot ?? 99))

  return (
    <section className={styles.playersPanel} data-compact={compact || undefined} aria-labelledby="tender-players-heading">
      <Typography id="tender-players-heading" as="h2" variant="control" className={styles.playersTitle}>
        Игроки
      </Typography>
      <div className={styles.playerList}>
        {orderedPlayers.map((player, index) => {
          const isCurrent = player.playerId === currentUserId
          const isActive = player.playerId === activePlayerId
          const stableIndex = players.findIndex((candidate) => candidate.playerId === player.playerId)
          const accentIndex = (stableIndex >= 0 ? stableIndex : index) % playerAccents.length
          const playerName = player.displayName ?? player.playerId.slice(0, 8)
          const status = phase === 'access-slot-selection'
            ? player.requestedAccessSlot !== undefined ? 'подтвердил' : 'выбирает'
            : phase === 'power-allocation'
              ? player.powerAllocationConfirmed ? 'подтвердил' : 'выбирает'
              : isActive ? 'активен' : 'ожидает'
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
                {player.accessSlot !== undefined ? `слот ${player.accessSlot} · ${status}` : status}
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
              {playerName ?? 'Игрок'}
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

type EvidenceData = Pick<
  TenderView,
  'privateMeasurements' | 'privateTheses' | 'publicLaboratoryResults' | 'publicTheses'
>

export function TenderEvidence({
  compactLaboratoryInsets = false,
  data,
  laboratoryCountBelowResults = false,
}: {
  compactLaboratoryInsets?: boolean
  data: EvidenceData
  laboratoryCountBelowResults?: boolean
}) {
  const { t } = useI18n()
  const privateTheses = data.privateTheses ?? []
  const isEmpty = data.publicLaboratoryResults.length === 0
    && data.privateMeasurements.length === 0
    && privateTheses.length === 0
    && data.publicTheses.length === 0

  return (
    <div
      className={styles.evidence}
      data-compact-laboratory-insets={compactLaboratoryInsets || undefined}
      data-laboratory-count-below-results={laboratoryCountBelowResults || undefined}
    >
      {isEmpty && (
        <Typography variant="bodySm" tone="muted">Данные появятся после лабораторных опытов и тезисов.</Typography>
      )}
      {data.publicLaboratoryResults.length > 0 && (
        <section className={styles.evidenceSection}>
          <div className={styles.evidenceHeading}>
            <Typography as="h3" variant="control">Результаты лаборатории</Typography>
            <Typography as="span" variant="caption" className={styles.evidencePublicCountMobile}>
              Публично · {data.publicLaboratoryResults.length}
            </Typography>
          </div>
          <div className={styles.evidenceGrid}>
            {data.publicLaboratoryResults.map((result, index) => (
              <div key={index} className={styles.evidenceCard}>
                <span className={styles.evidenceRoute}>
                  <SignalGlyph signal={result.sourceSignal} />
                  <Typography as="strong" variant="caption">{t(signalLabelKeys[result.sourceSignal])}</Typography>
                  <Typography as="span" variant="bodySmMedium">→</Typography>
                  <SignalGlyph signal={result.receiverSignal} />
                  <Typography as="strong" variant="caption">{t(signalLabelKeys[result.receiverSignal])}</Typography>
                </span>
                <Typography variant="bodySmMedium">
                  {laboratoryResultLabels[result.publicResult] ?? result.publicResult}
                </Typography>
              </div>
            ))}
          </div>
          <Typography as="span" variant="caption" className={styles.evidencePublicCountDesktop}>
            Публично · {data.publicLaboratoryResults.length}
          </Typography>
        </section>
      )}

      {data.privateMeasurements.length > 0 && (
        <section className={styles.evidenceSection}>
          <div className={styles.evidenceHeading}>
            <Typography as="h3" variant="control">Личные измерения</Typography>
            <Typography as="span" variant="caption">Только вы · {data.privateMeasurements.length}</Typography>
          </div>
          <div className={styles.evidenceGrid}>
            {data.privateMeasurements.slice().reverse().map((measurement, index) => (
              <div key={index} className={styles.evidenceCard} data-private>
                <span className={styles.evidenceRoute}>
                  <SignalGlyph signal={measurement.sourceSignal} />
                  <Typography as="strong" variant="caption">{t(signalLabelKeys[measurement.sourceSignal])}</Typography>
                  <Typography as="span" variant="bodySmMedium">→</Typography>
                  <SignalGlyph signal={measurement.receiverSignal} />
                  <Typography as="strong" variant="caption">{t(signalLabelKeys[measurement.receiverSignal])}</Typography>
                </span>
                <Typography variant="bodySmMedium">
                  {polarityRelationLabels[measurement.polarityRelation] ?? measurement.polarityRelation}
                </Typography>
              </div>
            ))}
          </div>
        </section>
      )}

      {privateTheses.length > 0 && (
        <section className={styles.evidenceSection}>
          <div className={styles.evidenceHeading}>
            <Typography as="h3" variant="control">Личные тезисы</Typography>
            <Typography as="span" variant="caption">Только вы · {privateTheses.length}</Typography>
          </div>
          <div className={styles.evidenceGrid}>
            {privateTheses.slice().reverse().map((thesis) => (
              <div key={thesis.id} className={styles.evidenceCard} data-private data-private-thesis>
                <span className={styles.evidenceSignal}>
                  <SignalGlyph signal={thesis.signalId} />
                  <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[thesis.signalId])}</Typography>
                </span>
                <Typography variant="caption" tone="muted">
                  {t(fieldTypeLabelKeys[thesis.fieldType])} · {t(polarityLabelKeys[thesis.polarity])}
                </Typography>
                <span className={styles.thesisChecks}>
                  <Typography as="span" variant="caption" data-correct={thesis.fieldTypeCorrect}>
                    {thesis.fieldTypeCorrect ? 'Тип верен' : 'Тип неверен'}
                  </Typography>
                  <Typography as="span" variant="caption" data-correct={thesis.polarityCorrect}>
                    {thesis.polarityCorrect ? 'Полярность верна' : 'Полярность неверна'}
                  </Typography>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.publicTheses.length > 0 && (
        <section className={styles.evidenceSection}>
          <div className={styles.evidenceHeading}>
            <Typography as="h3" variant="control">Публичные тезисы</Typography>
            <Typography as="span" variant="caption">{data.publicTheses.length}</Typography>
          </div>
          <div className={styles.evidenceGrid}>
            {data.publicTheses.map((thesis, index) => (
              <div key={index} className={styles.evidenceCard} data-correct={thesis.correct}>
                <span className={styles.evidenceSignal}>
                  <SignalGlyph signal={thesis.signalId} />
                  <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[thesis.signalId])}</Typography>
                </span>
                <Typography variant="caption" tone="muted">
                  {t(fieldTypeLabelKeys[thesis.fieldType])} · {t(polarityLabelKeys[thesis.polarity])}
                </Typography>
                <Typography variant="caption" tone={thesis.correct ? 'default' : 'destructive'}>
                  {thesis.correct ? 'Верно' : 'Неверно'} · {verificationLabels[thesis.verification] ?? thesis.verification}
                </Typography>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function TenderResearchData({ view }: { view: TenderView }) {
  const count = view.publicLaboratoryResults.length
    + view.privateMeasurements.length
    + (view.privateTheses?.length ?? 0)
    + view.publicTheses.length

  return (
    <details className={styles.researchData}>
      <summary>
        <span>
          <Typography as="strong" variant="bodySmMedium">Данные исследования</Typography>
          <Typography as="small" variant="caption" tone="muted">Лаборатория, личные измерения и тезисы</Typography>
        </span>
        <Typography as="span" variant="caption" className={styles.researchCount}>{count}</Typography>
      </summary>
      <TenderEvidence data={view} />
    </details>
  )
}

export function TenderPlanningContext({
  samples,
}: {
  samples: SignalId[]
}) {
  const { t } = useI18n()

  return (
    <div className={styles.planningContext}>
      <section className={styles.sampleInventory} aria-labelledby="planning-samples-heading">
        <div className={styles.sampleInventoryHeading}>
          <Typography id="planning-samples-heading" as="h2" variant="bodySmMedium">
            Ваши образцы
          </Typography>
          <Typography as="span" variant="caption" className={styles.sampleInventoryCount}>
            {samples.length} / 6
          </Typography>
        </div>
        <div className={styles.sampleInventoryList}>
          {samples.length > 0 ? samples.map((signal) => (
            <span key={signal} className={styles.sampleInventoryChip}>
              <SignalGlyph signal={signal} />
              <Typography as="strong" variant="caption">{t(signalLabelKeys[signal])}</Typography>
            </span>
          )) : (
            <Typography variant="caption" tone="muted">Образцов пока нет</Typography>
          )}
        </div>
      </section>

    </div>
  )
}
