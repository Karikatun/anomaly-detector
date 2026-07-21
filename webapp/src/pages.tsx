import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { AuthForm, useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'

export function HomePage() {
  const auth = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (auth.user) {
      void navigate({ to: '/rooms', replace: true })
    }
  }, [auth.user, navigate])

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (auth.sessionError && !auth.user) {
    return <SessionErrorState retry={auth.retrySession} />
  }

  if (auth.user) {
    return null
  }

  return (
    <section className="flex min-h-[80vh] items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <AuthForm />
      </div>
    </section>
  )
}

export function AppPage() {
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
          {auth.user?.displayName ?? auth.user?.email}
        </Typography>
        <Typography tone="muted">{auth.user?.email}</Typography>
      </div>

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

function LoadingState() {
  const { t } = useI18n()
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16">
      <Card className="w-fit">
        <CardContent className="flex items-center gap-3">
          <Spinner />
          <Typography variant="bodySm" tone="muted">
            {t('loading.session')}
          </Typography>
        </CardContent>
      </Card>
    </section>
  )
}

function SessionErrorState({ retry }: { retry: () => Promise<void> }) {
  const { t } = useI18n()
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16" role="alert">
      <Typography variant="h2">{t('error.session.title')}</Typography>
      <Typography tone="muted">
        {t('error.session.description')}
      </Typography>
      <Button type="button" className="w-fit" onClick={() => void retry()}>
        {t('error.session.retry')}
      </Button>
    </section>
  )
}
