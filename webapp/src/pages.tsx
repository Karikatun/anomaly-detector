import { useNavigate } from '@tanstack/react-router'
import {
  Add01Icon,
  File01Icon,
  Login03Icon,
  Logout01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { AuthForm, useAuth } from '@/features/auth'
import { RulesReferenceDialog } from '@/features/rules'
import { useI18n } from '@/platform/i18n'
import styles from './pages.module.css'

export function HomePage() {
  const auth = useAuth()

  if (auth.isBootstrapping) return <LoadingState />
  if (auth.user) {
    return (
      <AuthenticatedHome
        displayName={auth.user.displayName ?? auth.user.login}
        onLogout={() => auth.logout()}
      />
    )
  }
  return (
    <section className="flex min-h-screen items-center justify-center px-5 py-10">
      <AuthForm />
    </section>
  )
}

function AuthenticatedHome({
  displayName,
  onLogout,
}: {
  displayName: string
  onLogout: () => Promise<void>
}) {
  const navigate = useNavigate()

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
            <Button type="button" variant="ghost" className={styles.logout} onClick={() => void onLogout()} aria-label="Выйти">
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={1.6} aria-hidden="true" />
              <Typography variant="control" className={styles.logoutLabel}>ВЫЙТИ</Typography>
            </Button>
          </div>
        </header>

        <div className={styles.divider} />
        <div className={styles.actions}>
          <MenuCard
            accent="violet"
            title="СОЗДАТЬ КОМНАТУ"
            icon={Add01Icon}
            onClick={() => void navigate({ to: '/rooms' })}
          />
          <MenuCard
            accent="aqua"
            title="ВОЙТИ ПО КОДУ"
            icon={Login03Icon}
            onClick={() => void navigate({ to: '/rooms' })}
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

export function ProfilePage() {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.user, navigate])

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (!auth.isBootstrapping && !auth.user) {
    return null
  }

  if (auth.sessionError && !auth.user) {
    return <SessionErrorState retry={auth.retrySession} />
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          {t('app.profile.badge')}
        </Badge>
        <Typography variant="h1">
          {auth.user?.displayName ?? auth.user?.login}
        </Typography>
        <Typography tone="muted">{auth.user?.login}</Typography>
      </div>

      <Separator />

      {/* Display name editor */}
      <Card>
        <CardHeader>
          <CardTitle>{t('auth.displayName')}</CardTitle>
          <CardDescription>Измените отображаемое имя. Оно видно другим игрокам в матче.</CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayNameEditor
            currentName={auth.user?.displayName ?? ''}
            onSave={(name) => auth.updateProfile({ displayName: name })}
          />
        </CardContent>
      </Card>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.userId')}</CardTitle>
            <CardDescription wrap="break">{auth.user?.id}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.locale')}</CardTitle>
            <CardDescription>
              {auth.user?.locale === 'ru' ? t('app.profile.locale.ru') : t('app.profile.locale.en')}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.created')}</CardTitle>
            <CardDescription>{new Date(auth.user?.createdAt ?? '').toLocaleString()}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </section>
  )
}

function DisplayNameEditor({
  currentName,
  onSave,
}: {
  currentName: string
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) return
    setSaving(true)
    try {
      await onSave(trimmed)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch {
      // Error silently — user can retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="profile-display-name">Отображаемое имя</FieldLabel>
        <div className="flex gap-3">
          <Input
            id="profile-display-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }}
            className="flex-1"
          />
          <Button
            type="button"
            disabled={saving || !name.trim() || name.trim() === currentName}
            onClick={() => void handleSave()}
          >
            {done ? 'Сохранено!' : saving ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </Field>
    </FieldGroup>
  )
}

function LoadingState() {
  const { t } = useI18n()
  return (
    <section className="flex flex-col items-center justify-center gap-6 px-5 py-32">
      <Spinner />
      <Typography variant="bodySm" tone="muted">{t('loading.session')}</Typography>
    </section>
  )
}

function SessionErrorState({ retry }: { retry: () => Promise<void> }) {
  const { t } = useI18n()
  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <Card>
        <CardContent className="grid gap-4 py-8">
          <Typography variant="h4" tone="destructive">{t('error.session.title')}</Typography>
          <Typography>{t('error.session.description')}</Typography>
          <Button
            className="w-fit"
            onClick={() => void retry()}
          >
            {t('error.session.retry')}
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
