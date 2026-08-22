import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import type { AdminOverview, MailOperationsView } from '@anomaly-detector/contracts'

import { AdminApi, AdminApiError } from './api'
import { getApiBaseUrl } from './api-base-url'
import { MailPolicyScreen } from './mail-policy-screen'
import { OverviewScreen } from './overview-screen'

type AppState =
  | { kind: 'bootstrapping' }
  | { kind: 'anonymous'; error?: string }
  | { kind: 'concealed' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: AdminOverview; mailPolicy: MailOperationsView }

type ReadyView = 'mail-policy' | 'overview'

export default function App() {
  const api = useMemo(() => new AdminApi(getApiBaseUrl()), [])
  const [state, setState] = useState<AppState>({ kind: 'bootstrapping' })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [view, setView] = useState<ReadyView>('overview')

  const loadWorkspace = useCallback(async () => {
    try {
      const [data, mailPolicy] = await Promise.all([api.getOverview(), api.getMailPolicy()])
      setState({ kind: 'ready', data, mailPolicy })
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 404) {
        setState({ kind: 'concealed' })
        return
      }
      if (error instanceof AdminApiError && error.status === 401) {
        setState({ kind: 'anonymous' })
        return
      }
      setState({ kind: 'error', message: 'Не удалось загрузить операторский контур' })
    }
  }, [api])

  useEffect(() => {
    let active = true
    void api.restoreSession()
      .then(() => {
        if (active) return loadWorkspace()
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
  }, [api, loadWorkspace])

  const logout = async () => {
    try {
      await api.logout()
      setView('overview')
      setState({ kind: 'anonymous' })
    } catch {
      setState({ kind: 'error', message: 'Не удалось завершить сессию' })
    }
  }

  if (state.kind === 'bootstrapping') return <StateScreen title="Проверяем сессию…" />
  if (state.kind === 'anonymous') return <LoginScreen api={api} initialError={state.error} onAuthenticated={loadWorkspace} />
  if (state.kind === 'concealed') {
    return <ConcealedScreen onSwitchUser={() => void logout()} />
  }
  if (state.kind === 'error') {
    return <StateScreen title={state.message} actionLabel="Повторить" onAction={loadWorkspace} />
  }

  const loadOverviewPage = async (page: number) => {
    try {
      const data = await api.getOverview(page)
      setState((current) => current.kind === 'ready' ? { ...current, data } : current)
    } catch {
      setState({ kind: 'error', message: 'Не удалось загрузить системный обзор' })
    }
  }
  const refresh = async () => {
    setIsRefreshing(true)
    await loadOverviewPage(state.data.users.page)
    setIsRefreshing(false)
  }
  const changePage = async (page: number) => {
    setIsRefreshing(true)
    await loadOverviewPage(page)
    setIsRefreshing(false)
  }
  const reloadMailPolicy = async () => {
    const mailPolicy = await api.getMailPolicy()
    setState((current) => current.kind === 'ready' ? { ...current, mailPolicy } : current)
  }
  const executeMailCommand = async (operation: () => Promise<MailOperationsView>) => {
    try {
      const mailPolicy = await operation()
      setState((current) => current.kind === 'ready' ? { ...current, mailPolicy } : current)
    } catch (error) {
      await reloadMailPolicy().catch(() => undefined)
      throw error
    }
  }

  if (view === 'mail-policy') {
    return (
      <MailPolicyScreen
        data={state.mailPolicy}
        onBack={() => setView('overview')}
        onChangeStatus={(command) => executeMailCommand(() => api.changeMailPolicyStatus(command))}
        onImport={(command) => executeMailCommand(() => api.importMailPolicy(command))}
        onLogout={() => void logout()}
        onPublish={(command) => executeMailCommand(() => api.publishMailPolicy(command))}
        onReload={reloadMailPolicy}
      />
    )
  }
  return (
    <OverviewScreen
      data={state.data}
      isRefreshing={isRefreshing}
      onLogout={() => void logout()}
      onOpenMailPolicy={() => setView('mail-policy')}
      onPageChange={(page) => void changePage(page)}
      onRefresh={() => void refresh()}
    />
  )
}

export function ConcealedScreen({ onSwitchUser }: { onSwitchUser: () => void }) {
  return (
    <StateScreen
      title="Ресурс недоступен"
      actionLabel="Войти другим пользователем"
      onAction={onSwitchUser}
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
