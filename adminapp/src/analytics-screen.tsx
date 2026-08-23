import type {
  AnalyticsAdminOverview,
  AnalyticsFunnelEvent,
  AnalyticsSourceCategory,
} from '@anomaly-detector/contracts'

type AnalyticsScreenProps = {
  data: AnalyticsAdminOverview
  isRefreshing: boolean
  onBack: () => void
  onLogout: () => void
  onRefresh: () => void
  onWindowChange: (windowDays: 7 | 30 | 90) => void
}

const eventLabels: Record<AnalyticsFunnelEvent, string> = {
  landing_view: 'Landing',
  tutorial_cta: 'Перешли к обучению',
  registration_complete: 'Завершили регистрацию',
  tutorial_complete: 'Завершили обучение',
  recovery_email_confirmed: 'Подтвердили почту восстановления',
}

const sourceLabels: Record<AnalyticsSourceCategory, string> = {
  direct: 'Прямой переход',
  referral: 'С другого сайта',
  campaign: 'Разрешённая кампания',
  unknown: 'Не определено',
}

export function AnalyticsScreen({
  data,
  isRefreshing,
  onBack,
  onLogout,
  onRefresh,
  onWindowChange,
}: AnalyticsScreenProps) {
  return (
    <main className="screen">
      <div className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Только агрегаты · без посетителей и аккаунтов</p>
            <h1>Путь публичного MVP</h1>
            <p className="updated-at">Сформирован {formatDate(data.generatedAt)}</p>
          </div>
          <div className="header-actions">
            <button type="button" className="button button-secondary" onClick={onBack}>Назад</button>
            <button type="button" className="button" disabled={isRefreshing} onClick={onRefresh}>
              {isRefreshing ? 'Обновляем…' : 'Обновить'}
            </button>
            <button type="button" className="button button-secondary" onClick={onLogout}>Выйти</button>
          </div>
        </header>

        <nav className="analytics-windows" aria-label="Период аналитики">
          {([7, 30, 90] as const).map((windowDays) => (
            <button
              type="button"
              className={`button ${data.windowDays === windowDays ? '' : 'button-secondary'}`}
              disabled={isRefreshing}
              key={windowDays}
              onClick={() => onWindowChange(windowDays)}
            >
              {windowDays} дней
            </button>
          ))}
        </nav>

        <section className="analytics-summary" aria-label="Шаги воронки">
          {data.steps.map((step) => (
            <article className="metric-card" key={step.event}>
              <p className="label">{eventLabels[step.event]}</p>
              <p className="metric-value">{step.count}</p>
            </article>
          ))}
        </section>

        <div className="analytics-layout">
          <section className="panel">
            <h2>Переходы между соседними шагами</h2>
            <div className="status-list">
              {data.transitions.map((transition) => (
                <div className="analytics-transition" key={`${transition.from}:${transition.to}`}>
                  <span>{eventLabels[transition.from]} → {eventLabels[transition.to]}</span>
                  <strong>{formatPercent(transition.conversionRate)}</strong>
                  <small>{transition.count} переходов</small>
                </div>
              ))}
              {data.transitions.length === 0 && <p className="empty-copy">Переходов пока нет</p>}
            </div>
          </section>

          <section className="panel">
            <h2>Источники landing</h2>
            <div className="status-list">
              {data.sources.map((source) => (
                <div className="status-row" key={source.category}>
                  <span>{sourceLabels[source.category]}</span>
                  <strong>{source.landingViews}</strong>
                </div>
              ))}
              <div className="status-row analytics-bots">
                <span>Известные боты</span>
                <strong>{data.botLandingViews}</strong>
              </div>
            </div>
          </section>
        </div>

        <section className="panel">
          <h2>Динамика по дням</h2>
          <div
            aria-label="Динамика воронки по дням"
            className="table-wrap"
            role="region"
            tabIndex={0}
          >
            <table>
              <thead><tr><th>Дата</th><th>Шаг</th><th>Количество</th></tr></thead>
              <tbody>
                {data.daily.map((point) => (
                  <tr key={`${point.date}:${point.event}`}>
                    <td>{formatDay(point.date)}</td>
                    <td>{eventLabels[point.event]}</td>
                    <td>{point.count}</td>
                  </tr>
                ))}
                {data.daily.length === 0 && <tr><td colSpan={3}>Данных пока нет</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`))
}
