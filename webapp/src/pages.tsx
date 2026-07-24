import { useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import type { UserDto } from '@anomaly-detector/contracts'
import {
  Add01Icon,
  File01Icon,
  Login03Icon,
  Logout01Icon,
  UserCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type ReactNode, useEffect, useState } from 'react'

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
import {
  AuthForm,
  parseProfileForm,
  useAuth,
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

export function ProfilePage() {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.sessionError && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.sessionError, auth.user, navigate])

  return (
    <AuthSessionGate anonymous={null}>
      {(user) => (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          {t('app.profile.badge')}
        </Badge>
        <Typography variant="h1">
          {user.displayName ?? user.login}
        </Typography>
        <Typography tone="muted">{user.login}</Typography>
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
            currentName={user.displayName ?? ''}
            onSave={(input) => auth.updateProfile(input)}
          />
        </CardContent>
      </Card>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.userId')}</CardTitle>
            <CardDescription wrap="break">{user.id}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.locale')}</CardTitle>
            <CardDescription>
              {user.locale === 'ru' ? t('app.profile.locale.ru') : t('app.profile.locale.en')}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.created')}</CardTitle>
            <CardDescription>{new Date(user.createdAt).toLocaleString()}</CardDescription>
          </CardHeader>
        </Card>
      </div>
      </section>
      )}
    </AuthSessionGate>
  )
}

function DisplayNameEditor({
  currentName,
  onSave,
}: {
  currentName: string
  onSave: (input: { displayName: string }) => Promise<void>
}) {
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { displayName: currentName },
    onSubmit: async ({ value }) => {
      const parsed = parseProfileForm(value)
      if (!parsed.success || !parsed.data.displayName || parsed.data.displayName === currentName) return
      setServerError(null)
      try {
        await onSave({ displayName: parsed.data.displayName })
        setDone(true)
        setTimeout(() => setDone(false), 2_000)
      } catch (saveError) {
        setServerError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить имя')
      }
    },
  })

  return (
    <FieldGroup className="gap-4">
      <form.Field name="displayName">
        {(field) => {
          const validation = parseProfileForm({ displayName: field.state.value })
          return (
            <Field>
              <FieldLabel htmlFor="profile-display-name">Отображаемое имя</FieldLabel>
              <div className="flex gap-3">
                <Input
                  id="profile-display-name"
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    setDone(false)
                    setServerError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void form.handleSubmit()
                  }}
                  className="flex-1"
                />
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <Button
                      type="button"
                      disabled={isSubmitting
                        || !validation.success
                        || !validation.data.displayName
                        || validation.data.displayName === currentName}
                      onClick={() => void form.handleSubmit()}
                    >
                      {done ? 'Сохранено!' : isSubmitting ? 'Сохраняем...' : 'Сохранить'}
                    </Button>
                  )}
                </form.Subscribe>
              </div>
              {!validation.success && field.state.value.length > 0 && (
                <Typography role="alert" variant="bodySm" tone="destructive">
                  Имя должно содержать от 2 до 80 символов.
                </Typography>
              )}
              {serverError && (
                <Typography role="alert" variant="bodySm" tone="destructive">
                  {serverError}
                </Typography>
              )}
            </Field>
          )
        }}
      </form.Field>
    </FieldGroup>
  )
}

function AuthSessionGate({
  anonymous,
  children,
}: {
  anonymous: ReactNode
  children: (user: UserDto) => ReactNode
}) {
  const auth = useAuth()

  if (auth.isBootstrapping) return <LoadingState />
  if (auth.sessionError) return <SessionErrorState retry={auth.retrySession} />
  if (!auth.user) return anonymous
  return children(auth.user)
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
  const [retryError, setRetryError] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const handleRetry = async () => {
    setRetryError(false)
    setIsRetrying(true)
    try {
      await retry()
    } catch {
      setRetryError(true)
    } finally {
      setIsRetrying(false)
    }
  }
  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <Card>
        <CardContent className="grid gap-4 py-8">
          <Typography variant="h4" tone="destructive">{t('error.session.title')}</Typography>
          <Typography>{t('error.session.description')}</Typography>
          <Button
            className="w-fit"
            disabled={isRetrying}
            onClick={() => void handleRetry()}
          >
            {t('error.session.retry')}
          </Button>
          {retryError && (
            <Typography role="alert" variant="bodySm" tone="destructive">
              {t('error.session.description')}
            </Typography>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
