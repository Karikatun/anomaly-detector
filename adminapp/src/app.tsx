import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import type { AdminOverview } from '@anomaly-detector/contracts'

import { AdminApi, AdminApiError } from './api'
import { getApiBaseUrl } from './api-base-url'
import { OverviewScreen } from './overview-screen'

type AppState =
  | { kind: 'bootstrapping' }
  | { kind: 'anonymous'; error?: string }
  | { kind: 'concealed' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: AdminOverview }

export default function App() {
  const api = useMemo(() => new AdminApi(getApiBaseUrl()), [])
  const [state, setState] = useState<AppState>({ kind: 'bootstrapping' })
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadOverview = useCallback(async (page = 1) => {
    try {
      const data = await api.getOverview(page)
      setState({ kind: 'ready', data })
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 404) {
        setState({ kind: 'concealed' })
        return
      }
      if (error instanceof AdminApiError && error.status === 401) {
        setState({ kind: 'anonymous' })
        return
      }
      setState({ kind: 'error', message: 'Не удалось загрузить системный обзор' })
    }
  }, [api])

  useEffect(() => {
    let active = true
    void api.restoreSession()
      .then(() => {
        if (active) return loadOverview()
      })
      .catch((error) => {
        if (!active) return
        if (error instanceof AdminApiError && error.status === 401) {
          setState({ kind: 'anonymous' })
          return
        }
        setState({ kind: 'error', message: 'Не удалось проверить сессию' })
      })
    return () => { active = false }
  }, [api, loadOverview])

  if (state.kind === 'bootstrapping') return <StateScreen title="Проверяем сессию…" />
  if (state.kind === 'anonymous') return <LoginScreen api={api} initialError={state.error} onAuthenticated={loadOverview} />
  if (state.kind === 'concealed') return <StateScreen title="Ресурс недоступен" />
  if (state.kind === 'error') {
    return <StateScreen title={state.message} actionLabel="Повторить" onAction={loadOverview} />
  }

  const refresh = async () => {
    setIsRefreshing(true)
    await loadOverview(state.data.users.page)
    setIsRefreshing(false)
  }
  const changePage = async (page: number) => {
    setIsRefreshing(true)
    await loadOverview(page)
    setIsRefreshing(false)
  }
  const logout = async () => {
    try {
      await api.logout()
      setState({ kind: 'anonymous' })
    } catch {
      setState({ kind: 'error', message: 'Не удалось завершить сессию' })
    }
  }

  return (
    <OverviewScreen
      data={state.data}
      isRefreshing={isRefreshing}
      onLogout={() => void logout()}
      onPageChange={(page) => void changePage(page)}
      onRefresh={() => void refresh()}
    />
  )
}

function LoginScreen({
  api,
  initialError,
  onAuthenticated,
}: {
  api: AdminApi
  initialError?: string
  onAuthenticated: () => Promise<void>
}) {
  const [error, setError] = useState(initialError)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)
    setIsSubmitting(true)
    const data = new FormData(event.currentTarget)
    try {
      await api.login({
        login: String(data.get('login') ?? ''),
        password: String(data.get('password') ?? ''),
      })
      await onAuthenticated()
    } catch (submitError) {
      setError(
        submitError instanceof AdminApiError && submitError.status === 401
          ? 'Неверный логин или пароль'
          : 'Не удалось войти',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="state-screen">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">Защищённый контур</p>
        <h1>Вход оператора</h1>
        <label>Логин<input name="login" autoComplete="username" required /></label>
        <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </main>
  )
}

function StateScreen({
  actionLabel,
  onAction,
  title,
}: {
  actionLabel?: string
  onAction?: () => void
  title: string
}) {
  return (
    <main className="state-screen">
      <section className="state-card">
        <h1>{title}</h1>
        {actionLabel && onAction && <button className="button" type="button" onClick={onAction}>{actionLabel}</button>}
      </section>
    </main>
  )
}
