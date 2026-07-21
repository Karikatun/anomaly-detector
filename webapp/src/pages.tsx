import { Link } from '@tanstack/react-router'

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
  const { t } = useI18n()

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (auth.sessionError && !auth.user) {
    return <SessionErrorState retry={auth.retrySession} />
  }

  if (auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          {t('home.authenticated.badge')}
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <Typography variant="h1">{t('home.authenticated.title')}</Typography>
          <Typography className="max-w-2xl" tone="muted">
            {t('home.authenticated.description')}{' '}
            <Typography as="strong" variant="emphasis" tone="default">
              {auth.user.email}
            </Typography>
            . {t('home.authenticated.subtitle')}
          </Typography>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link to="/app">{t('home.authenticated.cta')}</Link>
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
      <div className="grid gap-5">
        <Badge variant="outline" className="w-fit">
          {t('home.guest.badge')}
        </Badge>
        <Typography className="max-w-3xl" variant="h1">
          {t('home.guest.title')}
        </Typography>
        <Typography className="max-w-2xl" tone="muted">
          {t('home.guest.description')}
        </Typography>
      </div>
      <AuthForm />
    </section>
  )
}

export function AppPage() {
  const auth = useAuth()
  const { t } = useI18n()

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (auth.sessionError && !auth.user) {
    return <SessionErrorState retry={auth.retrySession} />
  }

  if (!auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          {t('app.protected.badge')}
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <Typography variant="h1">{t('app.protected.title')}</Typography>
          <Typography className="max-w-2xl" tone="muted">
            {t('app.protected.description')}
          </Typography>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link to="/">{t('app.protected.cta')}</Link>
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          {t('app.profile.badge')}
        </Badge>
        <Typography variant="h1">
          {auth.user.displayName ?? auth.user.email}
        </Typography>
        <Typography tone="muted">{auth.user.email}</Typography>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.userId')}</CardTitle>
            <CardDescription wrap="break">{auth.user.id}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.locale')}</CardTitle>
            <CardDescription>
              {auth.user.locale === 'ru' ? t('app.profile.locale.ru') : t('app.profile.locale.en')}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('app.profile.created')}</CardTitle>
            <CardDescription>{new Date(auth.user.createdAt).toLocaleString()}</CardDescription>
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