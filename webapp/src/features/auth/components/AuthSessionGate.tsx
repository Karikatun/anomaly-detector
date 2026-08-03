import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'

import type { UserDto } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { useAuth } from '../use-auth'
import styles from './AuthSessionGate.module.css'

export function AuthSessionGate({
  anonymous,
  children,
}: {
  anonymous: ReactNode
  children: (user: UserDto) => ReactNode
}) {
  const auth = useAuth()

  if (auth.isBootstrapping) return <SessionLoadingState />
  if (auth.sessionError) return <SessionErrorState retry={auth.retrySession} />
  if (!auth.user) return anonymous
  return children(auth.user)
}

export function ProtectedPage({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.sessionError && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.sessionError, auth.user, navigate])

  return (
    <AuthSessionGate anonymous={null}>
      {() => children}
    </AuthSessionGate>
  )
}

function SessionLoadingState() {
  const { t } = useI18n()
  return (
    <SessionStateShell>
      <div className={styles.loading} role="status">
        <Typography as="h1" variant="srOnly">{t('loading.session')}</Typography>
        <Spinner />
        <Typography variant="bodySm" tone="muted">{t('loading.session')}</Typography>
      </div>
    </SessionStateShell>
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
    <SessionStateShell>
      <Card>
        <CardContent className={styles.errorContent}>
          <Typography as="h1" variant="h4" tone="destructive">{t('error.session.title')}</Typography>
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
    </SessionStateShell>
  )
}

function SessionStateShell({ children }: { children: ReactNode }) {
  return (
    <section className={styles.screen}>
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.content}>
        <header className={styles.brand} aria-hidden="true">
          <Typography as="span" className={styles.wordmark}>ANOMALY</Typography>
          <Typography as="span" className={styles.detector}>DETECTOR</Typography>
        </header>
        {children}
      </div>
    </section>
  )
}
