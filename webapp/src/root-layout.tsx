import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { RulesReferenceDialog } from '@/features/rules'
import { useI18n } from '@/platform/i18n'

export function RootLayout() {
  const auth = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [logoutFailed, setLogoutFailed] = useState(false)
  const isInTender = pathname.startsWith('/tenders/')
  const isInRoomLobby = pathname.startsWith('/rooms/')
  const isInMatchHistory = pathname === '/app'

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
      {auth.isAuthenticated && pathname !== '/' && !isInRoomLobby && !isInMatchHistory && (
        <header className="border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
            <Typography asChild variant="h6">
              <Link to="/">{t('app.logo')}</Link>
            </Typography>
            {isInTender ? (
              <div className="ml-auto flex items-center gap-2">
                <RulesReferenceDialog />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigate({ to: '/' })}
                >
                  {t('nav.leaveMatch')}
                </Button>
              </div>
            ) : (
              <nav className="ml-auto flex items-center gap-2" aria-label="Primary">
                <Button type="button" variant="ghost" size="sm" asChild>
                  <Link to="/">{t('nav.rooms')}</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" asChild>
                  <Link to="/app">{t('nav.matches')}</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" asChild>
                  <Link to="/profile">{t('nav.profile')}</Link>
                </Button>
                <RulesReferenceDialog triggerVariant="ghost" />
              </nav>
            )}
            {!isInTender && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
                  {t('button.logout')}
                </Button>
                {logoutFailed && auth.user && (
                  <Typography role="alert" variant="bodySm" tone="destructive">
                    {t('logout.failed')}
                  </Typography>
                )}
              </>
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
