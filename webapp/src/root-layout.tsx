import { Link, Outlet } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'

export function RootLayout() {
  const auth = useAuth()
  const { t } = useI18n()
  const [logoutFailed, setLogoutFailed] = useState(false)

  const logout = async () => {
    setLogoutFailed(false)
    try {
      await auth.logout()
    } catch {
      setLogoutFailed(true)
    }
  }

  return (
    <div className="min-h-svh bg-background/60 text-foreground">
      {auth.isAuthenticated && (
        <header className="border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
            <Typography asChild variant="h6">
              <Link to="/">{t('app.logo')}</Link>
            </Typography>
            <nav className="ml-auto flex items-center gap-2" aria-label="Primary">
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link to="/rooms">{t('nav.rooms')}</Link>
              </Button>
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link to="/app">{t('nav.matches')}</Link>
              </Button>
            </nav>
            <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
              {t('button.logout')}
            </Button>
            {logoutFailed && auth.user && (
              <Typography role="alert" variant="bodySm" tone="destructive">
                {t('logout.failed')}
              </Typography>
            )}
          </div>
        </header>
      )}
      <main>
        <Outlet />
      </main>
    </div>
  )
}
