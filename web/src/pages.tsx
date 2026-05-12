import { Link, Outlet } from '@tanstack/react-router'

import { AuthForm } from './components/AuthForm'
import { useAuth } from './lib/use-auth'

export function RootLayout() {
  const auth = useAuth()

  return (
    <main className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          web_app_demo
        </Link>
        <nav>
          <Link to="/" activeProps={{ className: 'active' }}>
            Auth
          </Link>
          <Link to="/app" activeProps={{ className: 'active' }}>
            App
          </Link>
        </nav>
        {auth.isAuthenticated && (
          <button type="button" className="ghost-action" onClick={() => void auth.logout()}>
            Logout
          </button>
        )}
      </header>
      <Outlet />
    </main>
  )
}

export function HomePage() {
  const auth = useAuth()

  if (auth.isBootstrapping) {
    return <p className="status">Checking session...</p>
  }

  if (auth.user) {
    return (
      <section className="hero">
        <p className="eyebrow">Authenticated starter</p>
        <h1>Session is active</h1>
        <p>
          Logged in as <strong>{auth.user.email}</strong>. This is the baseline auth pattern for
          future web features.
        </p>
        <Link to="/app" className="primary-link">
          Open app
        </Link>
      </section>
    )
  }

  return (
    <section className="hero-grid">
      <div className="hero-copy">
        <p className="eyebrow">Golden path template</p>
        <h1>Auth, validation, API state, and forms are wired from day one.</h1>
        <p>
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
    return <p className="status">Checking session...</p>
  }

  if (!auth.user) {
    return (
      <section className="hero">
        <p className="eyebrow">Protected example</p>
        <h1>Login required</h1>
        <p>This route intentionally stays small and shows where protected product UI begins.</p>
        <Link to="/" className="primary-link">
          Go to auth
        </Link>
      </section>
    )
  }

  return (
    <section className="dashboard">
      <div>
        <p className="eyebrow">Current user</p>
        <h1>{auth.user.displayName ?? auth.user.email}</h1>
        <p>{auth.user.email}</p>
      </div>
      <dl className="facts">
        <div>
          <dt>User ID</dt>
          <dd>{auth.user.id}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(auth.user.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
    </section>
  )
}
