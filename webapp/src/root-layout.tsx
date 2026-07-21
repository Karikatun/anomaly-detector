import { Link, Outlet } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'
import { cn } from '@/lib/utils'

const navLinkClass = cn(
  buttonVariants({ variant: 'ghost', size: 'sm' }),
  'text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-secondary-foreground data-[status=active]:hover:bg-secondary/80 data-[status=active]:hover:text-secondary-foreground'
)

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
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <Typography asChild variant="h6">
            <Link to="/">{t('app.logo')}</Link>
          </Typography>
          <nav className="ml-auto flex items-center gap-2" aria-label="Primary">
            <Typography asChild variant="control" tone="muted">
              <Link to="/" className={navLinkClass}>
                {t('nav.auth')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/rooms" className={navLinkClass}>
                {t('nav.rooms')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/app" className={navLinkClass}>
                {t('nav.matches')}
              </Link>
            </Typography>
          </nav>
          {auth.isAuthenticated && (
            <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
              {t('button.logout')}
            </Button>
          )}
          {logoutFailed && auth.user && (
            <Typography role="alert" variant="bodySm" tone="destructive">
              {t('logout.failed')}
            </Typography>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}