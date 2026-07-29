import {
  Analytics01Icon,
  ArrowDown01Icon,
  Award02Icon,
  CheckmarkCircle02Icon,
  ContractsIcon,
  FlashIcon,
  FlaskConicalIcon,
  Radar02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import type { CSSProperties, ReactNode } from 'react'
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

const roundRatingLabels = {
  contract: 'Контракт',
  final_model: 'Финальная модель',
  other: 'Другое начисление',
  thesis: 'Тезис',
} as const

function AuditGroup({
  accent,
  children,
  count,
  icon,
  title,
}: {
  accent: string
  children: ReactNode
  count: number
  icon: IconSvgElement
  title: string
}) {
  if (count === 0) return null

  return (
    <section
      className={styles.roundAuditSection}
      style={{ '--audit-accent': accent } as CSSProperties}
    >
      <header>
        <span className={styles.roundAuditSectionTitle}>
          <span className={styles.roundAuditSectionIcon}>
            <HugeiconsIcon icon={icon} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <Typography as="h4" variant="bodySmMedium">{title}</Typography>
        </span>
        <Typography as="span" variant="caption" className={styles.roundAuditSectionCount}>
          {count}
        </Typography>
      </header>
      <ul className={styles.auditEntries}>{[children].map((child) => child)}</ul>
    </section>
  )
}

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
  const playerName = (playerId: string) =>
    view.players.find((player) => player.playerId === playerId)?.displayName ?? playerId
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

      <section className={styles.section} aria-labelledby="completed-rounds-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-rounds-heading" as="h3" variant="bodySmMedium">
              Аудит по раундам
            </Typography>
            <Typography variant="caption" tone="muted">
              Фактический порядок действий, тайм-аутов, доказательств и начислений
            </Typography>
          </span>
        </div>
        <div className={styles.auditPlayerList}>
          {view.audit.rounds.map((round) => {
            const includesPlayer = (playerId: string) =>
              selectedPlayerId === 'all' || selectedPlayerId === playerId
            const accessSlots = round.accessSlots.filter((entry) => includesPlayer(entry.playerId))
            const powerAllocations = round.powerAllocations.filter((entry) => includesPlayer(entry.playerId))
            const reconnaissance = round.reconnaissance.filter((entry) => includesPlayer(entry.playerId))
            const laboratory = round.laboratory.filter((entry) => includesPlayer(entry.playerId))
            const theses = round.theses.filter((entry) => includesPlayer(entry.playerId))
            const contracts = round.contracts.filter((entry) => includesPlayer(entry.playerId))
            const ratingChanges = round.ratingChanges.filter((entry) => includesPlayer(entry.playerId))
            const entryCount = accessSlots.length
              + powerAllocations.length
              + reconnaissance.length
              + laboratory.length
              + theses.length
              + contracts.length
              + ratingChanges.length
            return (
              <details
                key={round.round}
                className={styles.roundAudit}
                data-audit-round={round.round}
              >
                <summary>
                  <Typography as="span" variant="bodySmMedium" className={styles.roundIndex}>
                    {String(round.round).padStart(2, '0')}
                  </Typography>
                  <span className={styles.roundSummaryCopy}>
                    <Typography as="strong" variant="bodySmMedium">Раунд {round.round}</Typography>
                    <Typography as="span" variant="caption" tone="muted">{entryCount} записей</Typography>
                  </span>
                  <span className={styles.roundToggle} aria-hidden="true">
                    <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.8} />
                  </span>
                </summary>

                <div className={styles.roundAuditContent}>
                  <AuditGroup
                    accent="#f4a51c"
                    icon={UserGroupIcon}
                    title="Слоты доступа"
                    count={accessSlots.length}
                  >
                    {accessSlots.map((entry) => (
                      <li key={`slot-${entry.playerId}`}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          {entry.resolution === 'timeout' && (
                            <Typography as="span" variant="caption" className={styles.auditTimeoutBadge}>
                              Тайм-аут
                            </Typography>
                          )}
                        </div>
                        <div className={styles.auditFacts}>
                          <span>
                            <Typography as="small" variant="caption">Запрошен</Typography>
                            <Typography as="strong" variant="caption">{entry.requestedSlot ?? '—'}</Typography>
                          </span>
                          <Typography as="span" variant="caption" className={styles.auditArrow}>→</Typography>
                          <span>
                            <Typography as="small" variant="caption">Назначен</Typography>
                            <Typography as="strong" variant="caption">{entry.assignedSlot ?? '—'}</Typography>
                          </span>
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#38bdf8"
                    icon={FlashIcon}
                    title="Распределение Мощности"
                    count={powerAllocations.length}
                  >
                    {powerAllocations.map((entry) => (
                      <li key={`power-${entry.playerId}`}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          {entry.resolution === 'timeout' && (
                            <Typography as="span" variant="caption" className={styles.auditTimeoutBadge}>
                              Тайм-аут
                            </Typography>
                          )}
                        </div>
                        <div className={styles.powerFacts}>
                          {[
                            ['Разведка', entry.allocation.reconnaissance],
                            ['Лаборатория', entry.allocation.laboratory],
                            ['Анализ', entry.allocation.modelAnalysis],
                            ['Контракты', entry.allocation.contracts],
                            ['Резерв', entry.allocation.reserve ?? 0],
                          ].map(([label, value]) => (
                            <span key={label}>
                              <Typography as="small" variant="caption">{label}</Typography>
                              <Typography as="strong" variant="caption">{value}</Typography>
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#38bdf8"
                    icon={Radar02Icon}
                    title="Разведка"
                    count={reconnaissance.length}
                  >
                    {reconnaissance.map((entry) => (
                      <li key={`recon-${entry.playerId}`}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          {entry.resolution === 'timeout' && (
                            <Typography as="span" variant="caption" className={styles.auditTimeoutBadge}>
                              Тайм-аут
                            </Typography>
                          )}
                          {entry.resolution === 'skipped' && (
                            <Typography as="span" variant="caption" className={styles.auditTimeoutBadge}>
                              Разведка пропущена: все Образцы уже получены
                            </Typography>
                          )}
                        </div>
                        <div className={styles.auditTagList}>
                          {entry.targets.length > 0 ? entry.targets.map((target, targetIndex) => (
                            <Typography key={`${target}-${targetIndex}`} as="span" variant="caption">
                              {target === 'unknown-sector'
                                ? 'Неизвестный сектор'
                                : t(signalLabelKeys[target])}
                            </Typography>
                          )) : (
                            <Typography as="span" variant="caption" tone="muted">
                              Без новых сигналов
                            </Typography>
                          )}
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#a968e8"
                    icon={FlaskConicalIcon}
                    title="Лаборатория"
                    count={laboratory.length}
                  >
                    {laboratory.map((entry, index) => {
                      const modeLabel = entry.mode === 'broad'
                        ? 'Широкое исследование'
                        : entry.mode === 'deep' ? 'Глубокое исследование' : 'Импульсный опыт'
                      return (
                        <li
                          key={`lab-${entry.playerId}-${index}`}
                          aria-label={`Исследование игрока ${playerName(entry.playerId)}`}
                        >
                          <div className={styles.auditEntryHeader}>
                            <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                              {playerName(entry.playerId)}
                            </Typography>
                            <Typography
                              as="span"
                              variant="caption"
                              className={entry.resolution === 'timeout' || entry.resolution === 'skipped'
                                ? styles.auditTimeoutBadge
                                : styles.auditModeBadge}
                            >
                              {entry.resolution === 'timeout'
                                ? 'Тайм-аут'
                                : entry.resolution === 'skipped'
                                  ? entry.skipReason === 'insufficient_samples'
                                    ? 'Пропущено: нужны два Образца'
                                    : 'Пропущено: все пары исследованы'
                                  : modeLabel}
                            </Typography>
                          </div>
                          <div className={styles.laboratoryTests}>
                            {entry.tests.map((test) => (
                              <div key={test.testId} className={styles.laboratoryTest}>
                                <Typography as="span" variant="caption" className={styles.testIdBadge}>
                                  {test.testId}
                                </Typography>
                                <Typography as="strong" variant="caption" className={styles.testRoute}>
                                  {t(signalLabelKeys[test.sourceSignal])}
                                  {' → '}
                                  {t(signalLabelKeys[test.receiverSignal])}
                                </Typography>
                                <Typography as="span" variant="caption" className={styles.testResultBadge}>
                                  {t(`tender.result.${test.publicResult}`)}
                                </Typography>
                                {test.usedByContractId && (
                                  <Typography as="span" variant="caption" className={styles.contractUseBadge}>
                                    Контракт {test.usedByContractId}
                                  </Typography>
                                )}
                              </div>
                            ))}
                          </div>
                          {entry.privateMeasurements?.map((measurement) => (
                            <div
                              key={`${measurement.sourceSignal}-${measurement.receiverSignal}`}
                              className={styles.privateMeasurement}
                            >
                              <Typography as="small" variant="caption">Приватное измерение</Typography>
                              <Typography as="strong" variant="caption">
                                {measurement.polarityRelation === 'same'
                                  ? 'Одинаковые полярности'
                                  : 'Разные полярности'}
                              </Typography>
                            </div>
                          ))}
                        </li>
                      )
                    })}
                  </AuditGroup>

                  <AuditGroup
                    accent="#22d3ee"
                    icon={Analytics01Icon}
                    title="Тезисы"
                    count={theses.length}
                  >
                    {theses.map((entry) => (
                      <li key={entry.id}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          <Typography as="span" variant="caption" className={styles.signalNameBadge}>
                            {t(signalLabelKeys[entry.signalId])}
                          </Typography>
                        </div>
                        <div className={styles.correctness}>
                          <Typography as="span" variant="caption" data-correct={entry.fieldTypeCorrect || undefined}>
                            Тип поля: {entry.fieldTypeCorrect ? 'верно' : 'неверно'}
                          </Typography>
                          <Typography as="span" variant="caption" data-correct={entry.polarityCorrect || undefined}>
                            Полярность: {entry.polarityCorrect ? 'верно' : 'неверно'}
                          </Typography>
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#f4a51c"
                    icon={ContractsIcon}
                    title="Контракты"
                    count={contracts.length}
                  >
                    {contracts.map((entry, index) => (
                      <li key={`${entry.playerId}-${entry.contractId ?? entry.outcome}-${index}`}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          {entry.contractId && (
                            <Typography as="span" variant="caption" className={styles.contractIdBadge}>
                              {entry.contractId}
                            </Typography>
                          )}
                        </div>
                        <Typography as="strong" variant="caption" className={styles.contractOutcome}>
                          {entry.outcome === 'timeout_released'
                            ? 'Резерв освобождён по тайм-ауту'
                            : entry.outcome === 'skipped'
                              ? 'Контракт пропущен'
                              : 'Контракт выполнен'}
                        </Typography>
                        {entry.outcome === 'skipped' ? (
                          <Typography variant="caption" tone="muted">
                            Подходящих доказательств нет
                          </Typography>
                        ) : entry.outcome === 'awarded' && (
                          <div className={styles.auditTagList}>
                            {(entry.evidenceTestIds.length > 0
                              ? entry.evidenceTestIds
                              : [entry.researchCertificationSignal ?? '—']
                            ).map((evidence) => (
                              <Typography key={evidence} as="span" variant="caption">
                                {evidence}
                              </Typography>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#2fcda3"
                    icon={Award02Icon}
                    title="Изменения рейтинга"
                    count={ratingChanges.length}
                  >
                    {ratingChanges.map((entry, index) => (
                      <li key={`${entry.playerId}-${entry.source}-${index}`}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          <Typography as="strong" variant="caption" className={styles.ratingChangeBadge}>
                            {entry.points >= 0 ? '+' : ''}{entry.points}
                          </Typography>
                        </div>
                        <Typography variant="caption" tone="muted">
                          Источник: {roundRatingLabels[entry.source]}
                        </Typography>
                      </li>
                    ))}
                  </AuditGroup>

                  {entryCount === 0 && (
                    <Typography variant="caption" tone="muted" className={styles.emptyRound}>
                      Для выбранного игрока записей в этом раунде нет.
                    </Typography>
                  )}
                </div>
              </details>
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
