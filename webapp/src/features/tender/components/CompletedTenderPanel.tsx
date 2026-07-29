import { Award02Icon, CheckmarkCircle02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { TenderView } from '@anomaly-detector/contracts'

import { Typography } from '@/components/ui/typography'
import { NativeSelect } from '@/components/ui/native-select'
import { useI18n } from '@/platform/i18n'
import {
  fieldTypeLabelKeys,
  polarityLabelKeys,
  signalIds,
  signalLabelKeys,
} from '../catalog'
import { SignalGlyph } from './SignalGlyph'
import { signalAccent } from './signal-visuals'
import styles from './CompletedTenderPanel.module.css'

type Props = {
  view: TenderView & { audit: NonNullable<TenderView['audit']> }
}

const ratingLabels = {
  completeModelBonus: 'Бонус полной модели',
  contractPoints: 'Выполненные контракты',
  correctPropertyPoints: 'Верные свойства модели',
  correctSignalPoints: 'Полностью раскрытые сигналы',
  otherPoints: 'Другие начисления',
  thesisPoints: 'Верные тезисы',
} as const

export function CompletedTenderPanel({ view }: Props) {
  const { t } = useI18n()
  const [selectedPlayerId, setSelectedPlayerId] = useState('all')
  const winnerIds = new Set(view.winnerPlayerIds ?? [])
  const winnerNames = view.players
    .filter((player) => winnerIds.has(player.playerId))
    .map((player) => player.displayName ?? player.playerId.slice(0, 8))
  const rankedPlayers = view.players.slice().sort((left, right) =>
    (view.audit.placementByPlayer[left.playerId] ?? 99)
    - (view.audit.placementByPlayer[right.playerId] ?? 99),
  )
  const selectedPlayers = selectedPlayerId === 'all'
    ? rankedPlayers
    : rankedPlayers.filter((player) => player.playerId === selectedPlayerId)
  const completionReasonLabel = {
    standard: 'Завершён после полного финального аудита',
    all_players_left: 'Завершён: все игроки покинули матч',
    last_active_player: 'Завершён досрочно: остался один активный игрок',
    all_players_forfeited: 'Завершён досрочно без победителя: все игроки выбыли',
  }[view.audit.completionReason]

  return (
    <section className={styles.panel} aria-labelledby="completed-tender-heading">
      <header className={styles.hero}>
        <span className={styles.completionIcon}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className={styles.heroCopy}>
          <Typography as="span" variant="caption" className={styles.eyebrow}>
            Исследование завершено
          </Typography>
          <Typography id="completed-tender-heading" as="h2" variant="h3">
            Тендер завершён
          </Typography>
          <Typography variant="bodySm" tone="muted">
            {completionReasonLabel}
          </Typography>
        </span>
        <span className={styles.winner}>
          <HugeiconsIcon icon={Award02Icon} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <Typography as="small" variant="caption">
              {winnerNames.length > 1 ? 'Победители' : 'Победитель'}
            </Typography>
            <Typography as="strong" variant="bodySmMedium">
              {winnerNames.join(', ') || '—'}
            </Typography>
          </span>
        </span>
      </header>

      <section className={styles.section} aria-labelledby="completed-signals-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-signals-heading" as="h3" variant="bodySmMedium">
              Конфигурация аномалии
            </Typography>
            <Typography variant="caption" tone="muted">Раскрытые свойства шести сигналов</Typography>
          </span>
          <Typography as="span" variant="caption" className={styles.count}>6 / 6</Typography>
        </div>

        <div className={styles.signalGrid}>
          {signalIds.map((signal) => {
            const properties = view.audit.anomalyConfiguration.signals[signal]
            return (
              <article
                key={signal}
                className={styles.signalCard}
                style={{ '--signal-accent': signalAccent(signal) } as CSSProperties}
              >
                <SignalGlyph signal={signal} className={styles.signalGlyph} />
                <span className={styles.signalCopy}>
                  <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[signal])}</Typography>
                  <span className={styles.signalProperties}>
                    <Typography as="span" variant="caption">{t(fieldTypeLabelKeys[properties.fieldType])}</Typography>
                    <Typography as="span" variant="caption">{t(polarityLabelKeys[properties.polarity])}</Typography>
                  </span>
                </span>
              </article>
            )
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="completed-ranking-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-ranking-heading" as="h3" variant="bodySmMedium">
              Итоговый рейтинг
            </Typography>
            <Typography variant="caption" tone="muted">Результаты участников тендера</Typography>
          </span>
          <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.7} aria-hidden="true" />
        </div>

        <ol className={styles.ranking}>
          {rankedPlayers.map((player) => {
            const isWinner = winnerIds.has(player.playerId)
            const placement = view.audit.placementByPlayer[player.playerId] ?? 1
            const breakdown = view.audit.ratingBreakdownByPlayer[player.playerId]
            const earnedRating = breakdown
              ? Object.entries(ratingLabels)
                  .map(([key, label]) => ({
                    label,
                    points: breakdown[key as keyof typeof ratingLabels],
                  }))
                  .filter(({ points }) => points !== 0)
              : []
            return (
              <li key={player.playerId} className={styles.player} data-winner={isWinner || undefined}>
                <div className={styles.playerSummary}>
                  <Typography as="span" variant="h5" className={styles.position}>
                    {String(placement).padStart(2, '0')}
                  </Typography>
                  <span className={styles.playerIdentity}>
                    <Typography as="strong" variant="bodySmMedium">
                      {player.displayName ?? player.playerId.slice(0, 8)}
                    </Typography>
                    <Typography as="span" variant="caption" tone="muted">Слот {player.accessSlot ?? '—'}</Typography>
                    {player.forfeited && (
                      <Typography as="span" variant="caption" tone="destructive">Окончательно выбыл</Typography>
                    )}
                  </span>
                  <span className={styles.playerStats}>
                    <span>
                      <Typography as="small" variant="caption">Рейтинг</Typography>
                      <Typography as="strong" variant="bodySmMedium">{player.rating}</Typography>
                    </span>
                    <span>
                      <Typography as="small" variant="caption">Бюджет</Typography>
                      <Typography as="strong" variant="bodySmMedium">{player.budget} M</Typography>
                    </span>
                  </span>
                  {isWinner && (
                    <span className={styles.winnerBadge}>
                      <HugeiconsIcon icon={Award02Icon} strokeWidth={1.8} aria-hidden="true" />
                      <Typography as="span" variant="caption">Победитель</Typography>
                    </span>
                  )}
                </div>
                <div
                  className={styles.ratingBreakdown}
                  aria-label={`За что начислен рейтинг игроку ${player.displayName ?? player.playerId.slice(0, 8)}`}
                >
                  <Typography as="span" variant="caption" className={styles.breakdownTitle}>
                    За что начислен рейтинг
                  </Typography>
                  {earnedRating.length > 0 ? (
                    <ul className={styles.breakdownList}>
                      {earnedRating.map(({ label, points }) => (
                        <li key={label}>
                          <Typography as="span" variant="caption">{label}</Typography>
                          <Typography as="strong" variant="caption" className={styles.breakdownPoints}>
                            {points > 0 ? '+' : ''}{points}
                          </Typography>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Typography variant="caption" tone="muted" className={styles.noRatingAwards}>
                      Начислений рейтинга нет
                    </Typography>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <label className={styles.playerFilter}>
        <Typography as="span" variant="caption">Показать детали игрока</Typography>
        <NativeSelect
          aria-label="Фильтр итогового аудита по игроку"
          value={selectedPlayerId}
          onChange={(event) => setSelectedPlayerId(event.target.value)}
        >
          <option value="all">Все игроки</option>
          {rankedPlayers.map((player) => (
            <option key={player.playerId} value={player.playerId}>
              {player.displayName ?? player.playerId.slice(0, 8)}
            </option>
          ))}
        </NativeSelect>
      </label>

      <section className={styles.section} aria-labelledby="completed-theses-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-theses-heading" as="h3" variant="bodySmMedium">
              Приватные тезисы
            </Typography>
            <Typography variant="caption" tone="muted">
              Раскрыты участникам только после завершения матча
            </Typography>
          </span>
        </div>
        <div className={styles.auditPlayerList}>
          {selectedPlayers.map((player) => {
            const theses = view.audit.privateThesesByPlayer[player.playerId] ?? []
            return (
              <article key={player.playerId} className={styles.auditPlayer}>
                <Typography as="h4" variant="bodySmMedium">
                  {player.displayName ?? player.playerId.slice(0, 8)}
                </Typography>
                {theses.length === 0 ? (
                  <Typography variant="caption" tone="muted">Тезисов нет</Typography>
                ) : (
                  <ul className={styles.auditEntries}>
                    {theses.map((thesis) => (
                      <li
                        key={thesis.id}
                        className={styles.signalAuditEntry}
                        style={{ '--signal-accent': signalAccent(thesis.signalId) } as CSSProperties}
                      >
                        <SignalGlyph signal={thesis.signalId} className={styles.auditSignalGlyph} />
                        <span className={styles.auditEntryCopy}>
                          <Typography as="strong" variant="bodySmMedium">
                            Раунд {thesis.round} · {t(signalLabelKeys[thesis.signalId])}
                          </Typography>
                          <Typography as="span" variant="caption">
                            {t(fieldTypeLabelKeys[thesis.fieldType])} · {t(polarityLabelKeys[thesis.polarity])}
                          </Typography>
                          <span className={styles.correctness}>
                            <Typography as="span" variant="caption" data-correct={thesis.fieldTypeCorrect || undefined}>
                              Тип: {thesis.fieldTypeCorrect ? 'верно' : 'неверно'}
                            </Typography>
                            <Typography as="span" variant="caption" data-correct={thesis.polarityCorrect || undefined}>
                              Полярность: {thesis.polarityCorrect ? 'верно' : 'неверно'}
                            </Typography>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="completed-final-models-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-final-models-heading" as="h3" variant="bodySmMedium">
              Официальные финальные модели
            </Typography>
            <Typography variant="caption" tone="muted">
              Неотправленные серверные черновики не раскрываются
            </Typography>
          </span>
        </div>
        <div className={styles.auditPlayerList}>
          {selectedPlayers.map((player) => {
            const result = view.audit.finalScientificModelsByPlayer[player.playerId]
            return (
              <article key={player.playerId} className={styles.auditPlayer}>
                <Typography as="h4" variant="bodySmMedium">
                  {player.displayName ?? player.playerId.slice(0, 8)}
                </Typography>
                {!result?.submitted ? (
                  <Typography variant="caption" tone="muted">Финальная модель не отправлена</Typography>
                ) : (
                  <ul className={styles.auditEntries}>
                    {signalIds.map((signal) => {
                      const claim = result.signals[signal]
                      if (!claim) return null
                      return (
                        <li
                          key={signal}
                          className={styles.signalAuditEntry}
                          style={{ '--signal-accent': signalAccent(signal) } as CSSProperties}
                        >
                          <SignalGlyph signal={signal} className={styles.auditSignalGlyph} />
                          <span className={styles.auditEntryCopy}>
                            <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[signal])}</Typography>
                            <span className={styles.correctness}>
                              {claim.fieldType && (
                                <Typography as="span" variant="caption" data-correct={claim.fieldTypeCorrect || undefined}>
                                  {t(fieldTypeLabelKeys[claim.fieldType])}: {claim.fieldTypeCorrect ? 'верно' : 'неверно'}
                                </Typography>
                              )}
                              {claim.polarity && (
                                <Typography as="span" variant="caption" data-correct={claim.polarityCorrect || undefined}>
                                  {t(polarityLabelKeys[claim.polarity])}: {claim.polarityCorrect ? 'верно' : 'неверно'}
                                </Typography>
                              )}
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </article>
            )
          })}
        </div>
      </section>
      {view.ruleset && (
        <Typography variant="caption" tone="muted">
          {t('rules.ruleset', { version: view.ruleset === 'tender-v2' ? '2' : '1' })}
        </Typography>
      )}
    </section>
  )
}
