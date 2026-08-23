import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import type {
  AdminOverview,
  AnalyticsAdminOverview,
  FeedbackQueueResponse,
  MailOperationsView,
} from '@anomaly-detector/contracts'

import { AdminApi, AdminApiError } from './api'
import { AnalyticsScreen } from './analytics-screen'
import { FeedbackScreen } from './feedback-screen'
import { getApiBaseUrl } from './api-base-url'
import { MailPolicyScreen } from './mail-policy-screen'
import { OverviewScreen } from './overview-screen'

type AppState =
  | { kind: 'bootstrapping' }
  | { kind: 'anonymous'; error?: string }
  | { kind: 'concealed' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      analytics: AnalyticsAdminOverview | null
      data: AdminOverview
      feedback: FeedbackQueueResponse
      mailPolicy: MailOperationsView
    }

type ReadyView = 'analytics' | 'feedback' | 'mail-policy' | 'overview'

export default function App() {
  const api = useMemo(() => new AdminApi(getApiBaseUrl()), [])
  const [state, setState] = useState<AppState>({ kind: 'bootstrapping' })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isAnalyticsRefreshing, setIsAnalyticsRefreshing] = useState(false)
  const [view, setView] = useState<ReadyView>('overview')

  const loadWorkspace = useCallback(async () => {
    try {
      const [data, feedback, mailPolicy, analytics] = await Promise.all([
        api.getOverview(),
        api.getFeedbackQueue({ page: 1, pageSize: 20 }),
        api.getMailPolicy(),
        api.getAnalytics(30).catch((error) => {
          if (error instanceof AdminApiError && error.status === 404) return null
          throw error
        }),
      ])
      setState({ kind: 'ready', analytics, data, feedback, mailPolicy })
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
  const reloadFeedback = async (page = state.feedback.page) => {
    const feedback = await api.getFeedbackQueue({ page, pageSize: state.feedback.pageSize })
    setState((current) => current.kind === 'ready' ? { ...current, feedback } : current)
  }
  const executeFeedbackCommand = async (operation: () => Promise<unknown>) => {
    await operation()
    await reloadFeedback()
  }
  const reloadAnalytics = async (windowDays = state.analytics?.windowDays ?? 30) => {
    setIsAnalyticsRefreshing(true)
    try {
      const analytics = await api.getAnalytics(windowDays)
      setState((current) => current.kind === 'ready' ? { ...current, analytics } : current)
    } finally {
      setIsAnalyticsRefreshing(false)
    }
  }

  if (view === 'analytics' && state.analytics) {
    return (
      <AnalyticsScreen
        data={state.analytics}
        isRefreshing={isAnalyticsRefreshing}
        onBack={() => setView('overview')}
        onLogout={() => void logout()}
        onRefresh={() => void reloadAnalytics()}
        onWindowChange={(windowDays) => void reloadAnalytics(windowDays)}
      />
    )
  }

  if (view === 'feedback') {
    return (
      <FeedbackScreen
        data={state.feedback}
        onBack={() => setView('overview')}
        onDeleteContact={(reportId, command) => executeFeedbackCommand(() => api.deleteFeedbackContact(reportId, command))}
        onLogout={() => void logout()}
        onPageChange={(page) => void reloadFeedback(page)}
        onRecordGithubIssue={(reportId, command) => executeFeedbackCommand(() => api.recordFeedbackGithubIssue(reportId, command))}
        onReject={(reportId, command) => executeFeedbackCommand(() => api.rejectFeedback(reportId, command))}
        onReload={() => reloadFeedback()}
        onResolve={(reportId, command) => executeFeedbackCommand(() => api.resolveFeedback(reportId, command))}
        onTake={(reportId, command) => executeFeedbackCommand(() => api.takeFeedback(reportId, command))}
      />
    )
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
      onOpenAnalytics={state.analytics ? () => setView('analytics') : undefined}
      onOpenFeedback={() => setView('feedback')}
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
