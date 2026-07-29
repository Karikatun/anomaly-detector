import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'

import { RoomsApi } from '../api'
import { roomQueryKeys } from '../queries'
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
    <main className={styles.screen}>
      <div className={styles.background} aria-hidden="true" />
      <section className={styles.panel} aria-labelledby="match-history-title">
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
          <div className={styles.feedback} role="status">
            <Spinner />
            <Typography>{t('matches.loading')}</Typography>
          </div>
        ) : matches.isError ? (
          <div className={styles.feedback} data-error>
            <Typography role="alert">{t('matches.error')}</Typography>
            <Button type="button" className={styles.retryButton} onClick={() => void matches.refetch()}>
              {t('matches.retry')}
            </Button>
          </div>
        ) : matches.data.length === 0 ? (
          <div className={styles.empty}>
            <Typography as="span" variant="h3" className={styles.emptyMark} aria-hidden="true">○</Typography>
            <Typography className={styles.emptyTitle}>{t('matches.empty.title')}</Typography>
            <Typography className={styles.emptyHint}>{t('matches.empty.description')}</Typography>
            <Button type="button" className={styles.primaryButton} onClick={() => void navigate({ to: '/' })}>
              {t('matches.empty.action')}
            </Button>
          </div>
        ) : (
          <div className={styles.history}>
            <div className={styles.tableHeader} aria-hidden="true">
              <Typography as="span" variant="control">{t('matches.column.date')}</Typography>
              <Typography as="span" variant="control">{t('matches.column.players')}</Typography>
              <Typography as="span" variant="control">{t('matches.column.status')}</Typography>
              <Typography as="span" variant="control">{t('matches.column.details')}</Typography>
            </div>

            <div className={styles.rows}>
              {matches.data.map((match) => {
                const isComplete = match.tenderPhase === 'complete'
                const status = match.tenderForfeited
                  ? t('matches.status.forfeited')
                  : match.tenderCompletionReason !== undefined
                    ? t('matches.status.earlyComplete')
                  : isComplete
                    ? t('matches.status.complete')
                    : t('matches.status.active')
                return (
                  <article className={styles.row} key={match.roomId}>
                    <div className={styles.cell} data-label={t('matches.column.date')}>
                      <Typography className={styles.date}>{formatUuidV7Date(match.tenderId)}</Typography>
                    </div>
                    <div className={styles.cell} data-label={t('matches.column.players')}>
                      <Typography className={styles.players}>{match.members.length}</Typography>
                    </div>
                    <div className={styles.cell} data-label={t('matches.column.status')}>
                      <Typography className={styles.status} data-complete={isComplete || undefined}>
                        <span className={styles.statusDot} aria-hidden="true" />
                        {status}
                      </Typography>
                    </div>
                    <div className={styles.actionCell}>
                      {match.tenderId && (!match.tenderForfeited || isComplete) ? (
                        <Button
                          type="button"
                          className={styles.detailsButton}
                          onClick={() => void navigate({
                            to: '/tenders/$tenderId',
                            params: { tenderId: match.tenderId! },
                            search: { from: 'matches' },
                          })}
                        >
                          {t('matches.details')}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

function formatUuidV7Date(tenderId: string | null | undefined): string {
  if (!tenderId || tenderId[14] !== '7') return '—'

  const timestamp = Number.parseInt(tenderId.replaceAll('-', '').slice(0, 12), 16)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'

  return matchDateFormatter.format(date)
}

const matchDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
