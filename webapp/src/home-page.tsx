import { Link, useNavigate } from '@tanstack/react-router'
import {
  Add01Icon,
  File01Icon,
  Login03Icon,
  Logout01Icon,
  Mortarboard01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useState } from 'react'

import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import expeditionStyles from '@/components/ExpeditionShell.module.css'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import {
  AuthForm,
  AuthSessionGate,
  capturePostAuthContinuation,
  consumePostAuthContinuation,
  useAuth,
  useLogoutAction,
} from '@/features/auth'
import {
  ProfileApi,
  useTutorialProgressQuery,
} from '@/features/profile'
import {
  CreateRoomDialog,
  JoinRoomDialog,
  RoomsApi,
  useCurrentMatchQuery,
} from '@/features/rooms'
import { RulesReferenceDialog } from '@/features/rules'
import { useI18n } from '@/platform/i18n'
import styles from './pages.module.css'

export function HomePage() {
  return (
    <AuthSessionGate
      anonymous={(
        <AuthForm
          footerRulesAction={(
            <RulesReferenceDialog triggerVariant="ghost" triggerLabelKey="rules.open" />
          )}
        />
      )}
    >
      {(user) => <AuthenticatedHome displayName={user.displayName ?? user.login} />}
    </AuthSessionGate>
  )
}

function AuthenticatedHome({
  displayName,
}: {
  displayName: string
}) {
  const navigate = useNavigate()
  const [continuationPath] = useState(() => {
    capturePostAuthContinuation(sessionStorage, new URL(window.location.href))
    return consumePostAuthContinuation(sessionStorage)
  })
  const auth = useAuth()
  const { t } = useI18n()
  const logoutAction = useLogoutAction()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false)
  const roomsApi = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const profileApi = useMemo(() => new ProfileApi(auth.transport), [auth.transport])
  const currentMatch = useCurrentMatchQuery(roomsApi)
  const tutorialProgress = useTutorialProgressQuery(profileApi)

  useEffect(() => {
    if (continuationPath === '/tutorial') {
      void navigate({ to: continuationPath, replace: true })
    }
  }, [continuationPath, navigate])

  if (continuationPath) return null

  const returnToCurrentMatch = () => {
    const match = currentMatch.data
    if (!match) return
    if (match.status === 'started' && match.tenderId) {
      void navigate({ to: '/tenders/$tenderId', params: { tenderId: match.tenderId }, search: { from: undefined } })
      return
    }
    void navigate({ to: '/rooms/$roomId', params: { roomId: match.roomId } })
  }

  return (
    <section className={expeditionStyles.screen} aria-label={t('home.menu.aria')}>
      <ExpeditionBackground />
      <div className={`${expeditionStyles.panel} ${styles.panel}`}>
        <header className={styles.header}>
          <Typography variant="h1" className={styles.title}>{t('home.menu.title')}</Typography>
          <div className={styles.account}>
            <Link
              to="/profile"
              className={styles.profileLink}
              aria-label={t('home.profile.open', { name: displayName })}
            >
              <div className={styles.avatar} aria-hidden="true"><span className={styles.avatarCore} /></div>
              <div className={styles.identity}>
                <Typography variant="bodySmMedium" className={styles.name}>{displayName}</Typography>
              </div>
            </Link>
            <Button
              type="button"
              variant="ghost"
              className={styles.logout}
              disabled={logoutAction.isPending}
              onClick={() => void logoutAction.logout()}
              aria-label={t('button.logout')}
            >
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.6} aria-hidden="true" />
              <Typography variant="control" className={styles.logoutLabel}>{t('button.logout').toUpperCase()}</Typography>
            </Button>
            {logoutAction.error && (
              <Typography role="alert" variant="bodySm" tone="destructive">
                {t('logout.failed')}
              </Typography>
            )}
          </div>
        </header>

        <div className={styles.divider} />
        <div className={styles.actions}>
          {currentMatch.isPending ? (
            <MenuCard
              accent="plain"
              disabled
              fullRow
              title={t('home.currentMatch.checking')}
              icon={Login03Icon}
              onClick={() => undefined}
            />
          ) : currentMatch.isError ? (
            <div className={styles.matchError} role="alert">
              <div className={styles.matchErrorCopy}>
                <Typography variant="h4">{t('home.currentMatch.error.title')}</Typography>
                <Typography variant="bodySm" tone="muted">
                  {t('home.currentMatch.error.description')}
                </Typography>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={currentMatch.isFetching}
                onClick={() => void currentMatch.refetch()}
              >
                {currentMatch.isFetching
                  ? t('home.currentMatch.error.retrying')
                  : t('home.currentMatch.error.retry')}
              </Button>
            </div>
          ) : currentMatch.data ? (
            <MenuCard
              accent="aqua"
              fullRow
              title={t('home.currentMatch.return')}
              description={t('home.currentMatch.description')}
              icon={Login03Icon}
              onClick={returnToCurrentMatch}
            />
          ) : (
            <>
              <MenuCard
                accent="violet"
                title={t('home.room.create')}
                icon={Add01Icon}
                onClick={() => setIsCreateDialogOpen(true)}
              />
              <MenuCard
                accent="aqua"
                title={t('home.room.join')}
                icon={Login03Icon}
                onClick={() => setIsJoinDialogOpen(true)}
              />
              <MenuCard
                accent="plain"
                fullRow
                title={t(tutorialProgress.data?.completedAt ? 'tutorial.menu.repeat' : 'tutorial.menu.start')}
                icon={Mortarboard01Icon}
                onClick={() => void navigate({ to: '/tutorial' })}
              />
            </>
          )}
          <MenuCard
            accent="plain"
            title={t('matches.title').toUpperCase()}
            icon={File01Icon}
            onClick={() => void navigate({ to: '/app' })}
          />
          <MenuCard
            accent="plain"
            title={t('nav.profile').toUpperCase()}
            icon={UserCircleIcon}
            onClick={() => void navigate({ to: '/profile' })}
          />
          <RulesReferenceDialog
            triggerVariant="ghost"
            triggerClassName={styles.rulesTrigger}
            triggerLabelKey="rules.menu"
            triggerTextClassName={styles.rulesLabel}
          />
        </div>
        <CreateRoomDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />
        <JoinRoomDialog open={isJoinDialogOpen} onOpenChange={setIsJoinDialogOpen} />
      </div>
    </section>
  )
}

function MenuCard({
  accent,
  title,
  description,
  icon,
  onClick,
  fullRow = false,
  disabled = false,
}: {
  accent: 'violet' | 'aqua' | 'plain'
  title: string
  description?: string
  icon: typeof Add01Icon
  onClick: () => void
  fullRow?: boolean
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`${styles.menuCard} ${styles[accent]} ${fullRow ? styles.fullRow : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.copy}>
        <Typography variant="h3" className={styles.cardTitle}>{title}</Typography>
        {description && <Typography variant="body" className={styles.cardDescription}>{description}</Typography>}
      </span>
      <span className={styles.iconWrap} aria-hidden="true"><HugeiconsIcon icon={icon} strokeWidth={1.35} /></span>
    </Button>
  )
}
