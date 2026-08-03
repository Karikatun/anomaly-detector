import { Link, useNavigate } from '@tanstack/react-router'
import {
  Add01Icon,
  File01Icon,
  Login03Icon,
  Logout01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState } from 'react'

import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import expeditionStyles from '@/components/ExpeditionShell.module.css'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import {
  AuthForm,
  AuthSessionGate,
  useAuth,
  useLogoutAction,
} from '@/features/auth'
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
  const auth = useAuth()
  const { t } = useI18n()
  const logoutAction = useLogoutAction()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false)
  const roomsApi = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const currentMatch = useCurrentMatchQuery(roomsApi)

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
    <section className={expeditionStyles.screen} aria-label="Главное меню">
      <ExpeditionBackground />
      <div className={`${expeditionStyles.panel} ${styles.panel}`}>
        <header className={styles.header}>
          <Typography variant="h1" className={styles.title}>ГЛАВНОЕ МЕНЮ</Typography>
          <div className={styles.account}>
            <Link
              to="/profile"
              className={styles.profileLink}
              aria-label={`Открыть профиль пользователя ${displayName}`}
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
              aria-label="Выйти"
            >
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.6} aria-hidden="true" />
              <Typography variant="control" className={styles.logoutLabel}>ВЫЙТИ</Typography>
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
              title="ПРОВЕРЯЕМ АКТИВНЫЙ МАТЧ"
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
              title="ВЕРНУТЬСЯ В МАТЧ"
              description="У вас есть активный незавершённый матч"
              icon={Login03Icon}
              onClick={returnToCurrentMatch}
            />
          ) : (
            <>
              <MenuCard
                accent="violet"
                title="СОЗДАТЬ КОМНАТУ"
                icon={Add01Icon}
                onClick={() => setIsCreateDialogOpen(true)}
              />
              <MenuCard
                accent="aqua"
                title="ВОЙТИ ПО КОДУ"
                icon={Login03Icon}
                onClick={() => setIsJoinDialogOpen(true)}
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
            title="ПРОФИЛЬ"
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
