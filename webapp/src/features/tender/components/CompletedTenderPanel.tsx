import { translate } from '../../../platform/i18n'
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
import { useEffect, useState } from 'react'

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
  currentUserId?: string
  view: TenderView & { audit: NonNullable<TenderView['audit']> }
}

const ratingLabels = {
  completeModelBonus: translate('tender.completedTenderPanel.copy.001'),
  contractPoints: translate('tender.completedTenderPanel.copy.002'),
  correctPropertyPoints: translate('tender.completedTenderPanel.copy.003'),
  correctSignalPoints: translate('tender.completedTenderPanel.copy.004'),
  otherPoints: translate('tender.completedTenderPanel.copy.005'),
  thesisPoints: translate('tender.completedTenderPanel.copy.006'),
} as const

const roundRatingLabels = {
  contract: translate('tender.completedTenderPanel.copy.007'),
  final_model: translate('tender.completedTenderPanel.copy.008'),
  other: translate('tender.completedTenderPanel.copy.009'),
  thesis: translate('tender.completedTenderPanel.copy.010'),
} as const

const contractKindLabels = {
  complex: translate('tender.completedTenderPanel.copy.011'),
  final: translate('tender.completedTenderPanel.copy.012'),
  light: translate('tender.completedTenderPanel.copy.013'),
  scientific: translate('tender.completedTenderPanel.copy.014'),
} as const

const laboratoryProtocolLabels = {
  continuous: translate('tender.completedTenderPanel.copy.015'),
  impulse: translate('tender.completedTenderPanel.copy.016'),
} as const

const contractRoleLabels = {
  receiver: translate('tender.completedTenderPanel.copy.017'),
  source: translate('tender.completedTenderPanel.copy.018'),
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

export function CompletedTenderPanel({ currentUserId, view }: Props) {
  const { t } = useI18n()
  const winnerIds = new Set(view.winnerPlayerIds ?? [])
  const winnerNames = view.players
    .filter((player) => winnerIds.has(player.playerId))
    .map((player) => player.displayName ?? player.playerId.slice(0, 8))
  const rankedPlayers = view.players.slice().sort((left, right) =>
    (view.audit.placementByPlayer[left.playerId] ?? 99)
    - (view.audit.placementByPlayer[right.playerId] ?? 99),
  )
  const currentPlayer = rankedPlayers.find((player) => player.playerId === currentUserId)
    ?? rankedPlayers[0]
  const otherPlayers = rankedPlayers.filter((player) => player.playerId !== currentPlayer?.playerId)
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentPlayer?.playerId ?? 'all')
  const [desktopAudit, setDesktopAudit] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 48rem)')
    const applyViewport = () => {
      setDesktopAudit(media.matches)
      setSelectedPlayerId(media.matches ? 'all' : currentPlayer?.playerId ?? 'all')
    }
    applyViewport()
    media.addEventListener('change', applyViewport)
    return () => media.removeEventListener('change', applyViewport)
  }, [currentPlayer?.playerId])
  const playerName = (playerId: string) =>
    view.players.find((player) => player.playerId === playerId)?.displayName ?? playerId
  const completionReasonLabel = {
    standard: translate('tender.completedTenderPanel.copy.019'),
    all_players_left: translate('tender.completedTenderPanel.copy.020'),
    last_active_player: translate('tender.completedTenderPanel.copy.021'),
    all_players_forfeited: translate('tender.completedTenderPanel.copy.022'),
  }[view.audit.completionReason]
  const ratingEntries = (playerId: string) => {
    const breakdown = view.audit.ratingBreakdownByPlayer[playerId]
    return breakdown
      ? Object.entries(ratingLabels)
          .map(([key, label]) => ({
            label,
            points: breakdown[key as keyof typeof ratingLabels],
          }))
          .filter(({ points }) => points !== 0)
      : []
  }
  const renderPlayerModels = (players: typeof rankedPlayers) => (
    <div className={styles.auditPlayerList}>
      {players.map((player) => {
        const result = view.audit.finalScientificModelsByPlayer[player.playerId]
        return (
          <article key={player.playerId} className={styles.auditPlayer}>
            <Typography as="h4" variant="bodySmMedium">
              {player.displayName ?? player.playerId.slice(0, 8)}
            </Typography>
            {!result?.submitted ? (
              <Typography variant="caption" tone="muted">{translate('tender.completedTenderPanel.copy.023')}</Typography>
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
                              {t(fieldTypeLabelKeys[claim.fieldType])}: {claim.fieldTypeCorrect ? translate('tender.completedTenderPanel.copy.024') : translate('tender.completedTenderPanel.copy.025')}
                            </Typography>
                          )}
                          {claim.polarity && (
                            <Typography as="span" variant="caption" data-correct={claim.polarityCorrect || undefined}>
                              {t(polarityLabelKeys[claim.polarity])}: {claim.polarityCorrect ? translate('tender.completedTenderPanel.copy.026') : translate('tender.completedTenderPanel.copy.027')}
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
  )

  return (
    <section className={styles.panel} aria-labelledby="completed-tender-heading">
      <header className={styles.hero}>
        <span className={styles.completionIcon}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className={styles.heroCopy}>
          <Typography as="span" variant="caption" className={styles.eyebrow}>
            
            {translate('tender.completedTenderPanel.copy.028')}
          </Typography>
          <Typography id="completed-tender-heading" as="h2" variant="h3">
            
            {translate('tender.completedTenderPanel.copy.029')}
          </Typography>
          <Typography variant="bodySm" tone="muted">
            {completionReasonLabel}
          </Typography>
        </span>
        <span className={styles.winner}>
          <HugeiconsIcon icon={Award02Icon} strokeWidth={1.8} aria-hidden="true" />
          <span>
            <Typography as="small" variant="caption">
              {winnerNames.length > 1 ? translate('tender.completedTenderPanel.copy.030') : translate('tender.completedTenderPanel.copy.031')}
            </Typography>
            <Typography as="strong" variant="bodySmMedium">
              {winnerNames.join(', ') || '—'}
            </Typography>
          </span>
        </span>
      </header>

      {currentPlayer && (
        <section className={styles.mobileOwnResult} aria-labelledby="completed-own-result-heading">
          <span>
            <Typography as="span" variant="caption" className={styles.eyebrow}>{translate('tender.completedTenderPanel.copy.032')}</Typography>
            <Typography id="completed-own-result-heading" as="h3" variant="h4">
              {translate('tender.completed.placement', {
                placement: view.audit.placementByPlayer[currentPlayer.playerId] ?? '—',
              })}
            </Typography>
            <Typography as="strong" variant="h3" className={styles.ownRating}>
              {translate('tender.completed.ratingValue', {
                rating: view.audit.ratingBreakdownByPlayer[currentPlayer.playerId]?.total ?? 0,
              })}
            </Typography>
          </span>
          <span className={styles.ownResultPlayer}>
            <Typography as="strong" variant="bodySmMedium">
              {currentPlayer.displayName ?? currentPlayer.playerId.slice(0, 8)}
            </Typography>
            <Typography as="span" variant="caption" tone="muted">
              
              {translate('tender.completed.rating', { rating: currentPlayer.rating })}
            </Typography>
          </span>
          <ul className={styles.mobileBreakdown} aria-label={translate('tender.completedTenderPanel.copy.035')}>
            {ratingEntries(currentPlayer.playerId).map(({ label, points }) => (
              <li key={label}>
                <Typography as="span" variant="caption">{label}</Typography>
                <Typography as="strong" variant="caption">
                  {points > 0 ? '+' : ''}{points}
                </Typography>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className={styles.auditDisclosure} data-audit-section="own-model" open={desktopAudit || undefined}>
        <summary>
          <Typography as="strong" variant="bodySmMedium">{translate('tender.completedTenderPanel.copy.036')}</Typography>
          <Typography as="span" variant="caption">{translate('tender.completedTenderPanel.copy.037')}</Typography>
        </summary>
        <div className={styles.disclosureBody}>
          <section className={styles.section} aria-labelledby="completed-own-model-heading">
            <div className={styles.sectionHeader}>
              <span>
                <Typography id="completed-own-model-heading" as="h3" variant="bodySmMedium">
                  
                  {translate('tender.completedTenderPanel.copy.038')}
                </Typography>
                <Typography variant="caption" tone="muted">
                  
                  {translate('tender.completedTenderPanel.copy.039')}
                </Typography>
              </span>
            </div>
            {renderPlayerModels(currentPlayer ? [currentPlayer] : [])}
          </section>
        </div>
      </details>

      <details className={styles.auditDisclosure} data-audit-section="configuration" open={desktopAudit || undefined}>
        <summary>
          <Typography as="strong" variant="bodySmMedium">{translate('tender.completedTenderPanel.copy.040')}</Typography>
          <Typography as="span" variant="caption">{translate('tender.completedTenderPanel.copy.041')}</Typography>
        </summary>
        <div className={styles.disclosureBody}>
        <section className={styles.section} aria-labelledby="completed-signals-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-signals-heading" as="h3" variant="bodySmMedium">
              
              {translate('tender.completedTenderPanel.copy.042')}
            </Typography>
            <Typography variant="caption" tone="muted">{translate('tender.completedTenderPanel.copy.043')}</Typography>
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
        </div>
      </details>

      <details
        className={`${styles.auditDisclosure} ${styles.otherPlayersDisclosure}`}
        data-audit-section="other-players"
        open={desktopAudit || undefined}
      >
        <summary>
          <Typography as="strong" variant="bodySmMedium">{translate('tender.completedTenderPanel.copy.044')}</Typography>
          <Typography as="span" variant="caption">
            {otherPlayers.length === 1 ? translate('tender.completedTenderPanel.copy.045') : translate('tender.completedTenderPanel.copy.046', { value1: otherPlayers.length })} ›
          </Typography>
        </summary>
        <div className={styles.disclosureBody}>
        <section className={styles.section} aria-labelledby="completed-ranking-heading">
        <div className={styles.sectionHeader}>
          <span>
            <Typography id="completed-ranking-heading" as="h3" variant="bodySmMedium">
              
              {translate('tender.completedTenderPanel.copy.047')}
            </Typography>
            <Typography variant="caption" tone="muted">{translate('tender.completedTenderPanel.copy.048')}</Typography>
          </span>
          <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.7} aria-hidden="true" />
        </div>

        <ol className={styles.ranking}>
          {rankedPlayers.map((player) => {
            const isWinner = winnerIds.has(player.playerId)
            const placement = view.audit.placementByPlayer[player.playerId] ?? 1
            const earnedRating = ratingEntries(player.playerId)
            return (
              <li
                key={player.playerId}
                className={styles.player}
                data-current-player={player.playerId === currentPlayer?.playerId || undefined}
                data-winner={isWinner || undefined}
              >
                <div className={styles.playerSummary}>
                  <Typography as="span" variant="h5" className={styles.position}>
                    {String(placement).padStart(2, '0')}
                  </Typography>
                  <span className={styles.playerIdentity}>
                    <Typography as="strong" variant="bodySmMedium">
                      {player.displayName ?? player.playerId.slice(0, 8)}
                    </Typography>
                    <Typography as="span" variant="caption" tone="muted">{translate('tender.completed.slot', { slot: player.accessSlot ?? '—' })}</Typography>
                    {player.forfeited && (
                      <Typography as="span" variant="caption" tone="destructive">{translate('tender.completedTenderPanel.copy.050')}</Typography>
                    )}
                  </span>
                  <span className={styles.playerStats}>
                    <span>
                      <Typography as="small" variant="caption">{translate('tender.completedTenderPanel.copy.051')}</Typography>
                      <Typography as="strong" variant="bodySmMedium">{player.rating}</Typography>
                    </span>
                    <span>
                      <Typography as="small" variant="caption">{translate('tender.completedTenderPanel.copy.052')}</Typography>
                      <Typography as="strong" variant="bodySmMedium">{translate('tender.completed.budgetValue', { budget: player.budget })}</Typography>
                    </span>
                  </span>
                  {isWinner && (
                    <span className={styles.winnerBadge}>
                      <HugeiconsIcon icon={Award02Icon} strokeWidth={1.8} aria-hidden="true" />
                      <Typography as="span" variant="caption">{translate('tender.completedTenderPanel.copy.053')}</Typography>
                    </span>
                  )}
                </div>
                <div
                  className={styles.ratingBreakdown}
                  aria-label={translate('tender.completedTenderPanel.copy.054', { value1: player.displayName ?? player.playerId.slice(0, 8) })}
                >
                  <Typography as="span" variant="caption" className={styles.breakdownTitle}>
                    
                    {translate('tender.completedTenderPanel.copy.055')}
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
                      
                      {translate('tender.completedTenderPanel.copy.056')}
                    </Typography>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
        <section className={styles.section} aria-labelledby="completed-other-models-heading">
          <div className={styles.sectionHeader}>
            <span>
              <Typography id="completed-other-models-heading" as="h3" variant="bodySmMedium">
                
                {translate('tender.completedTenderPanel.copy.057')}
              </Typography>
              <Typography variant="caption" tone="muted">
                
                {translate('tender.completedTenderPanel.copy.058')}
              </Typography>
            </span>
          </div>
          {renderPlayerModels(otherPlayers)}
        </section>
        </div>
      </details>

      <details className={styles.auditDisclosure} data-audit-section="full-audit" open={desktopAudit || undefined}>
        <summary>
          <Typography as="strong" variant="bodySmMedium">{translate('tender.completedTenderPanel.copy.059')}</Typography>
          <Typography as="span" variant="caption">{translate('tender.completedTenderPanel.copy.060')}</Typography>
        </summary>
        <div className={styles.disclosureBody}>
      <label className={styles.playerFilter}>
        <Typography as="span" variant="caption">{translate('tender.completedTenderPanel.copy.061')}</Typography>
        <NativeSelect
          aria-label={translate('tender.completedTenderPanel.copy.062')}
          value={selectedPlayerId}
          onChange={(event) => setSelectedPlayerId(event.target.value)}
        >
          <option value="all">{translate('tender.completedTenderPanel.copy.063')}</option>
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
              
              {translate('tender.completedTenderPanel.copy.064')}
            </Typography>
            <Typography variant="caption" tone="muted">
              
              {translate('tender.completedTenderPanel.copy.065')}
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
                    <Typography as="strong" variant="bodySmMedium">{translate('tender.completed.auditRound', { round: round.round })}</Typography>
                    <Typography as="span" variant="caption" tone="muted">{entryCount}  {translate('tender.completedTenderPanel.copy.067')}</Typography>
                  </span>
                  <span className={styles.roundToggle} aria-hidden="true">
                    <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.8} />
                  </span>
                </summary>

                <div className={styles.roundAuditContent}>
                  <section className={styles.roundPriority} aria-label={translate('tender.completedTenderPanel.copy.068', { value1: round.round })}>
                    <Typography as="h4" variant="caption">{translate('tender.completedTenderPanel.copy.069')}</Typography>
                    <ol>
                      {round.priorityPlayerIds.map((playerId, index) => (
                        <li key={playerId}>
                          <Typography as="span" variant="caption">
                            {index + 1}. {playerName(playerId)}
                          </Typography>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <AuditGroup
                    accent="#f4a51c"
                    icon={UserGroupIcon}
                    title={translate('tender.completedTenderPanel.copy.070')}
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
                              
                              {translate('tender.completedTenderPanel.copy.071')}
                            </Typography>
                          )}
                        </div>
                        <div className={styles.auditFacts}>
                          <span>
                            <Typography as="small" variant="caption">{translate('tender.completedTenderPanel.copy.072')}</Typography>
                            <Typography as="strong" variant="caption">{entry.requestedSlot ?? '—'}</Typography>
                          </span>
                          <Typography as="span" variant="caption" className={styles.auditArrow}>→</Typography>
                          <span>
                            <Typography as="small" variant="caption">{translate('tender.completedTenderPanel.copy.073')}</Typography>
                            <Typography as="strong" variant="caption">{entry.assignedSlot ?? '—'}</Typography>
                          </span>
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#38bdf8"
                    icon={FlashIcon}
                    title={translate('tender.completedTenderPanel.copy.074')}
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
                              
                              {translate('tender.completedTenderPanel.copy.075')}
                            </Typography>
                          )}
                        </div>
                        <div className={styles.powerFacts}>
                          {[
                            [translate('tender.completedTenderPanel.copy.076'), entry.allocation.reconnaissance],
                            [translate('tender.completedTenderPanel.copy.077'), entry.allocation.laboratory],
                            [translate('tender.completedTenderPanel.copy.078'), entry.allocation.modelAnalysis],
                            [translate('tender.completedTenderPanel.copy.079'), entry.allocation.contracts],
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
                    title={translate('tender.completedTenderPanel.copy.080')}
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
                              
                              {translate('tender.completedTenderPanel.copy.081')}
                            </Typography>
                          )}
                          {entry.resolution === 'skipped' && (
                            <Typography as="span" variant="caption" className={styles.auditTimeoutBadge}>
                              
                              {translate('tender.completedTenderPanel.copy.082')}
                            </Typography>
                          )}
                        </div>
                        <div className={styles.auditTagList}>
                          {entry.targets.length > 0 ? entry.targets.map((target, targetIndex) => (
                            <Typography key={`${target}-${targetIndex}`} as="span" variant="caption">
                              {target === 'unknown-sector'
                                ? translate('tender.completedTenderPanel.copy.083')
                                : t(signalLabelKeys[target])}
                            </Typography>
                          )) : (
                            <Typography as="span" variant="caption" tone="muted">
                              
                              {translate('tender.completedTenderPanel.copy.084')}
                            </Typography>
                          )}
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#a968e8"
                    icon={FlaskConicalIcon}
                    title={translate('tender.completedTenderPanel.copy.085')}
                    count={laboratory.length}
                  >
                    {laboratory.map((entry, index) => {
                      const modeLabel = entry.mode === 'broad'
                        ? translate('tender.completedTenderPanel.copy.086')
                        : entry.mode === 'deep' ? translate('tender.completedTenderPanel.copy.087') : translate('tender.completedTenderPanel.copy.088')
                      return (
                        <li
                          key={`lab-${entry.playerId}-${index}`}
                          aria-label={translate('tender.completedTenderPanel.copy.089', { value1: playerName(entry.playerId) })}
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
                                ? translate('tender.completedTenderPanel.copy.090')
                                : entry.resolution === 'skipped'
                                  ? entry.skipReason === 'insufficient_samples'
                                    ? translate('tender.completedTenderPanel.copy.091')
                                    : translate('tender.completedTenderPanel.copy.092')
                                  : modeLabel}
                            </Typography>
                          </div>
                          <div className={styles.laboratoryTests}>
                            {entry.tests.map((test) => (
                              <div key={test.testId} className={styles.laboratoryTest}>
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
                                    
                                    {translate('tender.completedTenderPanel.copy.093')}
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
                              <Typography as="small" variant="caption">{translate('tender.completedTenderPanel.copy.094')}</Typography>
                              <Typography as="strong" variant="caption">
                                {measurement.polarityRelation === 'same'
                                  ? translate('tender.completedTenderPanel.copy.095')
                                  : translate('tender.completedTenderPanel.copy.096')}
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
                    title={translate('tender.completedTenderPanel.copy.097')}
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
                            
                            {translate('tender.completed.fieldResult', {
                              field: t(fieldTypeLabelKeys[entry.fieldType]),
                              correctness: entry.fieldTypeCorrect ? translate('tender.completedTenderPanel.copy.099') : translate('tender.completedTenderPanel.copy.100'),
                            })}
                          </Typography>
                          <Typography as="span" variant="caption" data-correct={entry.polarityCorrect || undefined}>
                            
                            {translate('tender.completed.polarityResult', {
                              polarity: t(polarityLabelKeys[entry.polarity]),
                              correctness: entry.polarityCorrect ? translate('tender.completedTenderPanel.copy.102') : translate('tender.completedTenderPanel.copy.103'),
                            })}
                          </Typography>
                        </div>
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#f4a51c"
                    icon={ContractsIcon}
                    title={translate('tender.completedTenderPanel.copy.104')}
                    count={contracts.length}
                  >
                    {contracts.map((entry, index) => (
                      <li key={`${entry.playerId}-${entry.contractId ?? entry.outcome}-${index}`}>
                        <div className={styles.auditEntryHeader}>
                          <Typography as="strong" variant="caption" className={styles.auditPlayerBadge}>
                            {playerName(entry.playerId)}
                          </Typography>
                          {entry.conditions && (
                            <Typography as="span" variant="caption" className={styles.auditModeBadge}>
                              {translate('tender.completed.contractReward', {
                                kind: contractKindLabels[entry.conditions.kind],
                                rating: entry.conditions.ratingReward,
                              })}
                            </Typography>
                          )}
                        </div>
                        <Typography as="strong" variant="caption" className={styles.contractOutcome}>
                          {entry.outcome === 'timeout_released'
                            ? translate('tender.completedTenderPanel.copy.105')
                            : entry.outcome === 'skipped'
                              ? translate('tender.completedTenderPanel.copy.106')
                              : translate('tender.completedTenderPanel.copy.107')}
                        </Typography>
                        {entry.outcome === 'skipped' ? (
                          <Typography variant="caption" tone="muted">
                            
                            {translate('tender.completedTenderPanel.copy.108')}
                          </Typography>
                        ) : entry.outcome === 'awarded' && (
                          <div className={styles.contractDetails}>
                            {entry.conditions && (
                              <>
                                <Typography as="span" variant="caption">
                                  
                                  {translate('tender.completed.target', {
                                    signal: t(signalLabelKeys[entry.conditions.targetSignal]),
                                    role: contractRoleLabels[entry.conditions.targetRole],
                                  })}
                                </Typography>
                                <Typography as="span" variant="caption">
                                  {entry.conditions.kind === 'scientific'
                                    ? translate('tender.completedTenderPanel.copy.110', { value1: t(signalLabelKeys[entry.conditions.targetSignal]) })
                                    : translate('tender.completedTenderPanel.copy.111', { value1: [
                                        t(`tender.result.${entry.conditions.requiredPublicResult}`),
                                        ...((entry.conditions.kind === 'complex' || entry.conditions.kind === 'final')
                                          && entry.conditions.requiredSecondaryPublicResult
                                          ? [t(`tender.result.${entry.conditions.requiredSecondaryPublicResult}`)]
                                          : []),
                                      ].join(' + ') })}
                                </Typography>
                                {(entry.conditions.kind === 'complex' || entry.conditions.kind === 'final') && (
                                  <Typography as="span" variant="caption">
                                    
                                    {translate('tender.completedTenderPanel.copy.112')}
                                  </Typography>
                                )}
                              </>
                            )}
                            {entry.evidenceTests.map((evidence) => (
                              <Typography key={evidence.testId} as="span" variant="caption">
                                
                                {translate('tender.completed.evidence', { signal: t(signalLabelKeys[evidence.sourceSignal]) })}
                                {' → '}
                                {t(signalLabelKeys[evidence.receiverSignal])}
                                {' · '}
                                {laboratoryProtocolLabels[evidence.protocol]}
                                {' · '}
                                {t(`tender.result.${evidence.publicResult}`)}
                              </Typography>
                            ))}
                            {entry.researchCertificationSignal && (
                              <Typography as="span" variant="caption">
                                
                                {translate('tender.completed.certificationEvidence', { signal: t(signalLabelKeys[entry.researchCertificationSignal]) })}
                              </Typography>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </AuditGroup>

                  <AuditGroup
                    accent="#2fcda3"
                    icon={Award02Icon}
                    title={translate('tender.completedTenderPanel.copy.115')}
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
                          
                          {translate('tender.completed.ratingSource', { source: roundRatingLabels[entry.source] })}
                        </Typography>
                      </li>
                    ))}
                  </AuditGroup>

                  {entryCount === 0 && (
                    <Typography variant="caption" tone="muted" className={styles.emptyRound}>
                      
                      {translate('tender.completedTenderPanel.copy.117')}
                    </Typography>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      </section>
        </div>
      </details>
      {view.ruleset && (
        <Typography variant="caption" tone="muted">
          {t('rules.ruleset', { version: view.ruleset === 'tender-v2' ? '2' : '1' })}
        </Typography>
      )}
    </section>
  )
}
