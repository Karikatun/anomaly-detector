import { Link, Outlet } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { cn } from '@/lib/utils'

const navLinkClass = cn(
  buttonVariants({ variant: 'ghost', size: 'sm' }),
  'text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-secondary-foreground data-[status=active]:hover:bg-secondary/80 data-[status=active]:hover:text-secondary-foreground'
)

export function RootLayout() {
  const auth = useAuth()
  const [logoutErrorUser, setLogoutErrorUser] = useState(auth.user)

  const logout = async () => {
    setLogoutErrorUser(null)
    try {
      await auth.logout()
    } catch {
      setLogoutErrorUser(auth.user)
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <Typography asChild variant="h6">
            <Link to="/">web_app_demo</Link>
          </Typography>
          <nav className="ml-auto flex items-center gap-2" aria-label="Primary">
            <Typography asChild variant="control" tone="muted">
              <Link to="/" className={navLinkClass}>
                Auth
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/app" className={navLinkClass}>
                App
              </Link>
            </Typography>
          </nav>
          {auth.isAuthenticated && (
            <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
              Logout
            </Button>
          )}
          {auth.user && logoutErrorUser === auth.user && (
            <Typography role="alert" variant="bodySm" tone="destructive">
              Logout failed. Your session is still active; please try again.
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
