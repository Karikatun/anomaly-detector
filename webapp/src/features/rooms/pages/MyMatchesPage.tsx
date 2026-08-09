import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft01Icon, ArrowRight01Icon, Award02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo } from 'react'

import type { RoomView } from '@anomaly-detector/contracts'

import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import expeditionStyles from '@/components/ExpeditionShell.module.css'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'

import { RoomsApi } from '../api'
import { roomQueryKeys } from '../queries'
import { formatUuidV7Date } from './match-history'
import styles from './MyMatchesPage.module.css'

export function MyMatchesPage() {
  return (
    <ProtectedPage>
      <MyMatchesContent />
    </ProtectedPage>
  )
}

function MyMatchesContent() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
  const api = useMemo(() => new RoomsApi(auth.transport), [auth.transport])

  const matches = useQuery({
    queryKey: roomQueryKeys.mine(),
    queryFn: () => api.listMatches(),
    refetchInterval: (query) => query.state.data?.some((match) => match.tenderPhase !== 'complete')
      ? 2_000
      : false,
  })

  return (
    <main className={expeditionStyles.screen}>
      <ExpeditionBackground />
      <section className={expeditionStyles.panel} aria-labelledby="match-history-title">
        <header className={styles.header}>
          <Typography variant="h1" id="match-history-title" className={styles.title}>
            {t('matches.title')}
          </Typography>
          <Button
            className={styles.backButton}
            type="button"
            variant="ghost"
            onClick={() => void navigate({ to: '/' })}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.7} aria-hidden="true" />
            {t('matches.back')}
          </Button>
        </header>

        {matches.isPending ? (
          <MatchHistoryFeedback state="loading" />
        ) : matches.isError ? (
          <MatchHistoryFeedback state="error" onAction={() => void matches.refetch()} />
        ) : matches.data.length === 0 ? (
          <MatchHistoryFeedback state="empty" onAction={() => void navigate({ to: '/' })} />
        ) : (
          <MatchHistoryList
            currentUserId={auth.user?.id}
            matches={matches.data}
            onOpen={(tenderId) => void navigate({
              to: '/tenders/$tenderId',
              params: { tenderId },
              search: { from: 'matches' },
            })}
          />
        )}
      </section>
    </main>
  )
}

export function MatchHistoryFeedback({
  state,
  onAction,
}: {
  state: 'loading' | 'error' | 'empty'
  onAction?: () => void
}) {
  const { t } = useI18n()

  if (state === 'loading') {
    return (
      <div className={styles.feedback} role="status">
        <Spinner />
        <Typography>{t('matches.loading')}</Typography>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className={styles.feedback} data-error>
        <Typography role="alert">{t('matches.error')}</Typography>
        <Button type="button" className={styles.retryButton} onClick={onAction}>
          {t('matches.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.empty}>
      <Typography as="span" variant="h3" className={styles.emptyMark} aria-hidden="true">○</Typography>
      <Typography className={styles.emptyTitle}>{t('matches.empty.title')}</Typography>
      <Typography className={styles.emptyHint}>{t('matches.empty.description')}</Typography>
      <Button type="button" className={styles.primaryButton} onClick={onAction}>
        {t('matches.empty.action')}
      </Button>
    </div>
  )
}

export function MatchHistoryList({
  currentUserId,
  matches,
  onOpen,
}: {
  currentUserId?: string
  matches: RoomView[]
  onOpen: (tenderId: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className={styles.history} role="table" aria-label={t('matches.title')}>
      <div className={styles.tableHeader} role="row">
        <Typography as="span" variant="control" role="columnheader">{t('matches.column.date')}</Typography>
        <Typography as="span" variant="control" role="columnheader">{t('matches.column.players')}</Typography>
        <Typography as="span" variant="control" role="columnheader">{t('matches.column.place')}</Typography>
        <Typography as="span" variant="control" role="columnheader">{t('matches.column.details')}</Typography>
      </div>

      <div className={styles.rows} role="rowgroup">
        {matches.map((match) => {
          const isComplete = match.tenderPhase === 'complete'
          const status = match.tenderForfeited
            ? t('matches.status.forfeited')
            : match.tenderCompletionReason !== undefined
              ? t('matches.status.earlyComplete')
              : isComplete
                ? t('matches.status.complete')
                : t('matches.status.active')
          const date = formatUuidV7Date(match.tenderId)
          return (
            <article className={styles.row} role="row" key={match.roomId}>
              <div className={`${styles.cell} ${styles.dateCell}`} role="cell" data-label={t('matches.column.date')}>
                <span className={styles.dateCopy}>
                  <Typography as="strong" variant="bodySmMedium" className={styles.date}>{date.date}</Typography>
                  <Typography as="span" variant="caption" className={styles.time}>{date.time}</Typography>
                </span>
                <span className={styles.matchMeta}>
                  <Typography as="span" variant="caption" className={styles.status} data-complete={isComplete || undefined}>
                    <span className={styles.statusDot} aria-hidden="true" />
                    {status}
                  </Typography>
                  {match.tenderRuleset && (
                    <Typography as="span" variant="caption" className={styles.rulesetBadge}>
                      {t('rules.ruleset', { version: match.tenderRuleset === 'tender-v2' ? '2' : '1' })}
                    </Typography>
                  )}
                </span>
              </div>

              <div className={`${styles.cell} ${styles.playersCell}`} role="cell" data-label={t('matches.column.players')}>
                <span className={styles.playersHeading}>
                  <HugeiconsIcon icon={UserGroupIcon} strokeWidth={1.7} aria-hidden="true" />
                  <Typography as="span" variant="caption">
                    {t('matches.players.count', { count: match.members.length })}
                  </Typography>
                </span>
                <ul className={styles.playerList}>
                  {match.members.map((member) => (
                    <li key={member.userId} title={member.displayName}>
                      <Typography as="span" variant="bodySm">{member.displayName}</Typography>
                      {member.userId === currentUserId && (
                        <Typography as="span" variant="caption" className={styles.youBadge}>{t('matches.player.you')}</Typography>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`${styles.cell} ${styles.placeCell}`} role="cell" data-label={t('matches.column.place')}>
                <HugeiconsIcon icon={Award02Icon} strokeWidth={1.7} aria-hidden="true" />
                {match.tenderPlacement ? (
                  <Typography as="strong" variant="h4">{t('matches.place.value', { place: match.tenderPlacement })}</Typography>
                ) : (
                  <Typography as="span" variant="caption" tone="muted">{t('matches.place.pending')}</Typography>
                )}
              </div>

              <div className={styles.actionCell} role="cell">
                {match.tenderId && (!match.tenderForfeited || isComplete) ? (
                  <Button type="button" className={styles.detailsButton} onClick={() => onOpen(match.tenderId!)}>
                    {t('matches.details')}
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.7} aria-hidden="true" />
                  </Button>
                ) : (
                  <Typography variant="caption" tone="muted">{t('matches.details.unavailable')}</Typography>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
