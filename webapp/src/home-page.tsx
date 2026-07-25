import { useNavigate } from '@tanstack/react-router'
import {
  Add01Icon,
  File01Icon,
  Login03Icon,
  Logout01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import {
  AuthForm,
  AuthSessionGate,
  useLogoutAction,
} from '@/features/auth'
import { CreateRoomDialog, JoinRoomDialog } from '@/features/rooms'
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
  const { t } = useI18n()
  const logoutAction = useLogoutAction()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false)

  return (
    <section className={styles.screen} aria-label="Главное меню">
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.panel}>
        <header className={styles.header}>
          <Typography variant="h1" className={styles.title}>ГЛАВНОЕ МЕНЮ</Typography>
          <div className={styles.account}>
            <div className={styles.avatar} aria-hidden="true"><span className={styles.avatarCore} /></div>
            <div className={styles.identity}>
              <Typography variant="bodySmMedium" className={styles.name}>{displayName}</Typography>
            </div>
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
          <MenuCard
            accent="plain"
            title="МОИ МАТЧИ"
            description="История ваших матчей и аудит"
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
}: {
  accent: 'violet' | 'aqua' | 'plain'
  title: string
  description?: string
  icon: typeof Add01Icon
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`${styles.menuCard} ${styles[accent]}`}
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
