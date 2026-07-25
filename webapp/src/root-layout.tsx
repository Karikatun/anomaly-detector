import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useAuth, useLogoutAction } from '@/features/auth'
import { RulesReferenceDialog } from '@/features/rules'
import { useI18n } from '@/platform/i18n'

export function RootLayout() {
  const auth = useAuth()
  const { t } = useI18n()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const logoutAction = useLogoutAction()
  const isInTender = pathname.startsWith('/tenders/')
  const isInRoomLobby = pathname.startsWith('/rooms/')
  const isInMatchHistory = pathname === '/app'
  const isInProfile = pathname === '/profile'

  return (
    <div className="min-h-svh min-w-0 overflow-x-clip bg-background/60 text-foreground">
      {auth.isAuthenticated && pathname !== '/' && !isInTender && !isInRoomLobby && !isInMatchHistory && !isInProfile && (
        <header className="border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 w-full min-w-0 max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
            <Typography asChild variant="h6">
              <Link to="/">{t('app.logo')}</Link>
            </Typography>
            <nav className="ml-auto flex items-center gap-2" aria-label={t('nav.primary')}>
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logoutAction.isPending}
              onClick={() => void logoutAction.logout()}
            >
              {t('button.logout')}
            </Button>
            {logoutAction.error && auth.user && (
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
