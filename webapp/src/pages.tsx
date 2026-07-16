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

export function HomePage() {
  const auth = useAuth()

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
          Authenticated starter
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <Typography variant="h1">Session is active</Typography>
          <Typography className="max-w-2xl" tone="muted">
            Logged in as{' '}
            <Typography as="strong" variant="emphasis" tone="default">
              {auth.user.email}
            </Typography>
            .
            This is the baseline auth pattern for future web features.
          </Typography>
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
        <Typography className="max-w-3xl" variant="h1">
          Auth, validation, API state, and forms are wired from day one.
        </Typography>
        <Typography className="max-w-2xl" tone="muted">
          The web app uses shared Zod contracts, TanStack Query for server state, TanStack Form for
          input state, and an API client that refreshes sessions through the backend.
        </Typography>
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

  if (auth.sessionError && !auth.user) {
    return <SessionErrorState retry={auth.retrySession} />
  }

  if (!auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          Protected example
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <Typography variant="h1">Login required</Typography>
          <Typography className="max-w-2xl" tone="muted">
            This route intentionally stays small and shows where protected product UI begins.
          </Typography>
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
        <Typography variant="h1">
          {auth.user.displayName ?? auth.user.email}
        </Typography>
        <Typography tone="muted">{auth.user.email}</Typography>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>User ID</CardTitle>
            <CardDescription wrap="break">{auth.user.id}</CardDescription>
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
          <Typography variant="bodySm" tone="muted">
            Checking session...
          </Typography>
        </CardContent>
      </Card>
    </section>
  )
}

function SessionErrorState({ retry }: { retry: () => Promise<void> }) {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16" role="alert">
      <Typography variant="h2">Session check is temporarily unavailable</Typography>
      <Typography tone="muted">
        Your session was not cleared. Check the connection and try again.
      </Typography>
      <Button type="button" className="w-fit" onClick={() => void retry()}>
        Try again
      </Button>
    </section>
  )
}
