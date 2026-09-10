import { Award02Icon, CheckmarkCircle02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tabs } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import type { TenderView } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { presentCompletedTender, tenderPointUnit } from '../completed-tender-presenter'
import { CompletedTenderConfiguration, CompletedTenderModels } from './CompletedTenderEvidence'
import shared from './CompletedTenderPanel.module.css'
import styles from './CompletedTenderDesktop.module.css'

const ratingLabelKeys = {
  completeModelBonus: 'tender.completedTenderPanel.copy.001',
  contractPoints: 'tender.completedTenderPanel.copy.002',
  correctPropertyPoints: 'tender.completedTenderPanel.copy.003',
  correctSignalPoints: 'tender.completedTenderPanel.copy.004',
  otherPoints: 'tender.completedTenderPanel.copy.005',
  thesisPoints: 'tender.completedTenderPanel.copy.006',
} as const

export function CompletedTenderDesktop({ currentUserId, view, children }: {
  currentUserId?: string
  view: TenderView & { audit: NonNullable<TenderView['audit']> }
  children: ReactNode
}) {
  const { t } = useI18n()
  const presentation = presentCompletedTender(view, currentUserId)
  const { currentPlayer, currentPlayerIsWinner, rankedPlayers, winnerIds } = presentation
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentPlayer?.playerId ?? rankedPlayers[0]?.playerId)
  const [tab, setTab] = useState('score')
  const selectedPlayer = rankedPlayers.find((player) => player.playerId === selectedPlayerId)
  const playerName = (player: TenderView['players'][number]) => player.bot
    ? t(`tender.player.bot.${player.bot.difficulty}`)
    : player.displayName ?? player.playerId.slice(0, 8)
  const winnerNames = rankedPlayers.filter((player) => winnerIds.has(player.playerId)).map(playerName)
  const points = (value: number) => `${value} ${t(`tender.completedTenderPanel.points.${tenderPointUnit(value)}`)}`
  const factors = selectedPlayer ? presentation.standingFactors(selectedPlayer.playerId) : undefined

  return (
    <section className={`${shared.panel} ${styles.panel}`} aria-labelledby="completed-tender-heading">
      <header className={shared.hero}>
        <span className={shared.completionIcon}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className={shared.heroCopy}>
          <Typography id="completed-tender-heading" as="h2" variant="h3">
            {t('tender.completedTenderPanel.copy.029')}
          </Typography>
          <Typography variant="bodySm" tone="muted">{t(presentation.completionReasonKey)}</Typography>
        </span>
        {!currentPlayerIsWinner && winnerNames.length > 0 && (
          <span className={shared.winner}>
            <HugeiconsIcon icon={Award02Icon} strokeWidth={1.8} aria-hidden="true" />
            <span>
              <Typography as="small" variant="caption">
                {t(winnerNames.length > 1 ? 'tender.completedTenderPanel.copy.030' : 'tender.completedTenderPanel.copy.031')}
              </Typography>
              <Typography as="strong" variant="bodySmMedium">{winnerNames.join(', ')}</Typography>
            </span>
          </span>
        )}
      </header>

      {currentPlayer && (
        <section className={`${shared.ownResult} ${styles.ownResult}`} data-winner={currentPlayerIsWinner || undefined} aria-labelledby="completed-own-result-heading">
          <span className={shared.ownResultSummary}>
            <Typography as="span" variant="caption" className={shared.eyebrow}>
              {t(currentPlayerIsWinner ? 'tender.completedTenderPanel.currentPlayerWon' : 'tender.completedTenderPanel.currentPlayerResult')}
            </Typography>
            <Typography id="completed-own-result-heading" as="h3" variant="h4">
              {winnerNames.length > 0
                ? t('tender.completedTenderPanel.placementAndPoints', { value1: presentation.currentPlacement ?? '—', value2: points(currentPlayer.rating) })
                : t('tender.completed.desktop.noWinner')}
            </Typography>
          </span>
          <Typography variant="bodySm" className={shared.ownResultPlayer}>{playerName(currentPlayer)}</Typography>
        </section>
      )}

      <div className={styles.workspace}>
        <section className={`${shared.section} ${styles.roster}`} aria-labelledby="completed-roster-heading">
          <header className={shared.sectionHeader}>
            <span>
              <Typography id="completed-roster-heading" as="h3" variant="bodySmMedium">{t('tender.completed.desktop.participants')}</Typography>
              <Typography variant="caption" tone="muted">{t('tender.completed.desktop.choosePlayer')}</Typography>
            </span>
            <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.8} aria-hidden="true" />
          </header>
          <ol className={styles.ranking}>
            {rankedPlayers.map((player) => (
              <li key={player.playerId}>
                <button
                  type="button"
                  className={styles.player}
                  data-current-player={player.playerId === currentUserId || undefined}
                  data-winner={winnerIds.has(player.playerId) || undefined}
                  aria-label={t('tender.completed.desktop.selectPlayer', { player: playerName(player) })}
                  aria-pressed={player.playerId === selectedPlayerId}
                  onClick={() => setSelectedPlayerId(player.playerId)}
                >
                  <Typography as="span" variant="bodySmMedium" className={shared.position}>
                    {winnerNames.length > 0 ? String(view.audit.placementByPlayer[player.playerId] ?? '—').padStart(2, '0') : '—'}
                  </Typography>
                  <span className={styles.playerIdentity}>
                    <span className={styles.playerName}>
                      <Typography as="strong" variant="bodySmMedium">{playerName(player)}</Typography>
                      {player.playerId === currentUserId && <Typography as="span" variant="caption" className={shared.youBadge}>{t('tender.completedTenderPanel.copy.119')}</Typography>}
                    </span>
                    <Typography as="span" variant="caption" tone={player.forfeited ? 'destructive' : 'muted'}>
                      {player.forfeited ? t('tender.completedTenderPanel.copy.050')
                        : winnerIds.has(player.playerId) ? t('tender.completedTenderPanel.copy.053')
                          : t('tender.completed.slot', { slot: player.accessSlot ?? '—' })}
                    </Typography>
                  </span>
                  <span className={styles.playerRating}>
                    <Typography as="strong" variant="h5">{player.rating}</Typography>
                    <Typography as="small" variant="caption" tone="muted">{t('tender.completedTenderPanel.finalStanding.rating')}</Typography>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <details className={styles.standingRules}>
            <summary><Typography as="span" variant="caption">{t('tender.completedTenderPanel.finalStanding.title')}</Typography></summary>
            <Typography variant="caption" tone="muted">{t('tender.completedTenderPanel.finalStanding.order')}</Typography>
          </details>
        </section>

        {selectedPlayer && factors && (
          <section className={`${shared.section} ${styles.inspector}`} aria-label={t('tender.completed.desktop.inspector')}>
            <header className={styles.inspectorHeader}>
              <span>
                <Typography as="span" variant="caption" className={shared.eyebrow}>{t('tender.completed.desktop.inspector')}</Typography>
                <Typography as="h3" variant="h5">{playerName(selectedPlayer)}</Typography>
              </span>
              <Typography as="strong" variant="h4">{selectedPlayer.rating}</Typography>
            </header>
            <Tabs.Root value={tab} onValueChange={setTab} className={styles.tabs}>
              <Tabs.List className={styles.tabList} aria-label={t('tender.completed.desktop.inspector')}>
                <Tabs.Trigger className={styles.tabTrigger} value="score">{t('tender.completed.desktop.scoreTab')}</Tabs.Trigger>
                <Tabs.Trigger className={styles.tabTrigger} value="model">{t('tender.completed.desktop.modelTab')}</Tabs.Trigger>
              </Tabs.List>
              {/* Both panels participate in the same grid track. The inactive panel
                  reserves height, but is absent from focus and the accessibility tree. */}
              <div className={styles.tabPanels}>
                <Tabs.Content className={styles.tabPanel} value="score" forceMount aria-hidden={tab !== 'score'} inert={tab !== 'score'} tabIndex={tab === 'score' ? 0 : -1}>
                  <ul className={styles.scoreList} aria-label={t('tender.completedTenderPanel.copy.035')}>
                    {presentation.ratingEntries(selectedPlayer.playerId).map(({ key, points: value }) => (
                      <li key={key}>
                        <Typography as="span" variant="bodySm" tone="muted">{t(ratingLabelKeys[key])}</Typography>
                        <Typography as="strong" variant="bodySmMedium">{value > 0 ? '+' : ''}{value}</Typography>
                      </li>
                    ))}
                    {presentation.ratingEntries(selectedPlayer.playerId).length === 0 && (
                      <li><Typography variant="bodySm" tone="muted">{t('tender.completedTenderPanel.copy.056')}</Typography></li>
                    )}
                    <li className={styles.scoreTotal}>
                      <Typography as="span" variant="bodySmMedium">{t('tender.completedTenderPanel.finalStanding.rating')}</Typography>
                      <Typography as="strong" variant="bodySmMedium">{points(selectedPlayer.rating)}</Typography>
                    </li>
                  </ul>
                  <dl className={styles.resources}>
                    {[
                      [t('tender.completedTenderPanel.finalStanding.correctTheses'), factors.correctTheses],
                      [t('tender.completedTenderPanel.finalStanding.remainingBudget'), factors.remainingBudget],
                      [t('tender.completedTenderPanel.finalStanding.corporateTrust'), factors.corporateTrust],
                    ].map(([label, value]) => (
                      <div key={label}><Typography as="dt" variant="caption" tone="muted">{label}</Typography><Typography as="dd" variant="bodySmMedium">{value}</Typography></div>
                    ))}
                  </dl>
                  <Typography variant="caption" tone="muted">{t('tender.completedTenderPanel.finalStanding.trustExplanation')}</Typography>
                </Tabs.Content>
                <Tabs.Content className={styles.tabPanel} value="model" forceMount aria-hidden={tab !== 'model'} inert={tab !== 'model'} tabIndex={tab === 'model' ? 0 : -1}>
                  <CompletedTenderModels view={view} players={[selectedPlayer]} showPlayerNames={false} />
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </section>
        )}
      </div>

      <details className={styles.configuration}>
        <summary>
          <Typography as="strong" variant="bodySmMedium">{t('tender.completedTenderPanel.copy.040')}</Typography>
          <Typography as="span" variant="caption">{t('tender.completedTenderPanel.copy.041')}</Typography>
        </summary>
        <div className={styles.configurationBody}><CompletedTenderConfiguration view={view} /></div>
      </details>
      <footer className={styles.footer}>
        <Typography variant="caption" tone="muted">{t('tender.completed.desktop.auditHint')}</Typography>
        <Dialog>
          <DialogTrigger asChild><Button variant="outline">{t('tender.completed.desktop.fullAudit')}</Button></DialogTrigger>
          <DialogContent className={styles.auditDialog} placement="viewport" closeLabel={t('tender.completed.desktop.closeAudit')}>
            <DialogHeader className={styles.auditHeader}>
              <DialogTitle>{t('tender.completed.desktop.fullAudit')}</DialogTitle>
              <DialogDescription>{t('tender.completed.desktop.auditHint')}</DialogDescription>
            </DialogHeader>
            <div className={styles.auditBody}>{children}</div>
          </DialogContent>
        </Dialog>
      </footer>
    </section>
  )
}
