import { Link, Outlet } from '@tanstack/react-router'

import { AuthForm } from '@/components/AuthForm'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/use-auth'

const navLinkClass = cn(
  buttonVariants({ variant: 'ghost', size: 'sm' }),
  'text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-secondary-foreground data-[status=active]:hover:bg-secondary/80 data-[status=active]:hover:text-secondary-foreground'
)

export function RootLayout() {
  const auth = useAuth()

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <Link to="/" className="font-heading text-base font-semibold tracking-normal">
            web_app_demo
          </Link>
          <nav className="ml-auto flex items-center gap-2" aria-label="Primary">
            <Link to="/" className={navLinkClass}>
              Auth
            </Link>
            <Link to="/app" className={navLinkClass}>
              App
            </Link>
          </nav>
          {auth.isAuthenticated && (
            <Button type="button" variant="outline" size="sm" onClick={() => void auth.logout()}>
              Logout
            </Button>
          )}
        </div>
      </header>
      <Outlet />
    </main>
  )
}

export function HomePage() {
  const auth = useAuth()

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          Authenticated starter
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <h1 className="font-heading text-4xl font-semibold leading-tight tracking-normal">
            Session is active
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Logged in as <strong className="font-medium text-foreground">{auth.user.email}</strong>.
            This is the baseline auth pattern for future web features.
          </p>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link to="/app">Open app</Link>
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
      <div className="grid gap-5">
        <Badge variant="outline" className="w-fit">
          Golden path template
        </Badge>
        <h1 className="max-w-3xl font-heading text-4xl font-semibold leading-tight tracking-normal">
          Auth, validation, API state, and forms are wired from day one.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          The web app uses shared Zod contracts, TanStack Query for server state, TanStack Form for
          input state, and an API client that refreshes sessions through the backend.
        </p>
      </div>
      <AuthForm />
    </section>
  )
}

export function AppPage() {
  const auth = useAuth()

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (!auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          Protected example
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <h1 className="font-heading text-4xl font-semibold leading-tight tracking-normal">
            Login required
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            This route intentionally stays small and shows where protected product UI begins.
          </p>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link to="/">Go to auth</Link>
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          Current user
        </Badge>
        <h1 className="font-heading text-4xl font-semibold leading-tight tracking-normal">
          {auth.user.displayName ?? auth.user.email}
        </h1>
        <p className="text-muted-foreground">{auth.user.email}</p>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>User ID</CardTitle>
            <CardDescription className="break-all">{auth.user.id}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Created</CardTitle>
            <CardDescription>{new Date(auth.user.createdAt).toLocaleString()}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </section>
  )
}

function LoadingState() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16">
      <Card className="w-fit">
        <CardContent className="flex items-center gap-3">
          <Spinner />
          <p className="text-sm text-muted-foreground">Checking session...</p>
        </CardContent>
      </Card>
    </section>
  )
}
