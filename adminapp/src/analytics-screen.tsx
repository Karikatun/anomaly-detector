import type {
  AnalyticsAdminOverview,
  AnalyticsFunnelEvent,
  AnalyticsSourceCategory,
} from '@anomaly-detector/contracts'

type AnalyticsScreenProps = {
  data: AnalyticsAdminOverview
  error?: string
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
  campaign: 'Рекламные ссылки',
  unknown: 'Не определено',
}

const campaignLabels: Record<string, string> = {
  ad_01: 'Пять раундов, чтобы доказать свою теорию',
  ad_02: 'Собери друзей на орбитальной станции',
  ad_03: 'Что скрывает аномалия?',
  ad_04: 'Твой главный инструмент — логика',
  ad_05: 'Любишь настолки на дедукцию?',
  ad_06: 'Игры для любителей настольных игр',
}

function clickRatio(clicks: number, views: number) {
  return views === 0 ? '—' : formatPercent(clicks / views)
}

export function AnalyticsScreen({
  data,
  error,
  isRefreshing,
  onBack,
  onLogout,
  onRefresh,
  onWindowChange,
}: AnalyticsScreenProps) {
  const aggregate = data.mode === 'aggregate'
  const labels = aggregate ? {
    ...eventLabels,
    landing_view: 'Просмотры лендинга',
    tutorial_cta: 'Нажатия «Пройти обучение»',
  } : eventLabels
  const landingViews = data.steps.find((step) => step.event === 'landing_view')?.count ?? 0
  const tutorialClicks = data.steps.find((step) => step.event === 'tutorial_cta')?.count ?? 0
  return (
    <main className="screen">
      <div className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Только агрегаты · без посетителей и аккаунтов</p>
            <h1>{aggregate ? 'Лендинг и объявления' : 'Путь публичного MVP'}</h1>
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

        {error && <p className="command-feedback command-feedback-error" role="alert">{error}</p>}

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

        <section className={`analytics-summary${aggregate ? ' analytics-summary-aggregate' : ''}`} aria-label={aggregate ? 'Просмотры и клики' : 'Шаги воронки'}>
          {data.steps.map((step) => (
            <article className="metric-card" key={step.event}>
              <p className="label">{labels[step.event]}</p>
              <p className="metric-value">{step.count}</p>
            </article>
          ))}
          {aggregate && <article className="metric-card">
            <p className="label">Клики / просмотры</p>
            <p className="metric-value">{clickRatio(tutorialClicks, landingViews)}</p>
          </article>}
        </section>

        {aggregate && <section className="panel analytics-campaign-panel">
          <h2>Объявления</h2>
          <p className="catalog-boundary">Это просмотры и нажатия, не число уникальных людей. Повторное открытие считается новым просмотром. Регистрации и завершённые обучения не отслеживаются.</p>
          <ol className="analytics-campaigns">
            {data.campaigns.map((campaign) => <li className="analytics-campaign" key={campaign.campaign}>
              <div className="analytics-campaign-name">
                <h3>{campaignLabels[campaign.campaign] ?? campaign.campaign}</h3>
                <code>{campaign.campaign}</code>
              </div>
              <dl className="analytics-campaign-counts">
                <div><dt>Просмотры</dt><dd>{campaign.landingViews}</dd></div>
                <div><dt>Клики</dt><dd>{campaign.tutorialClicks}</dd></div>
                <div><dt>Клики / просмотры</dt><dd>{clickRatio(campaign.tutorialClicks, campaign.landingViews)}</dd></div>
              </dl>
            </li>)}
          </ol>
          {data.campaigns.length === 0 && <p className="empty-copy">Для разбивки по объявлениям добавьте метки в разрешённый список.</p>}
          {data.campaigns.length > 0 && data.campaigns.every((campaign) => campaign.landingViews === 0 && campaign.tutorialClicks === 0)
            && <p className="empty-copy">За выбранный период просмотров и кликов по этим объявлениям пока нет.</p>}
        </section>}

        <div className={`analytics-layout${aggregate ? ' analytics-layout-aggregate' : ''}`}>
          {!aggregate && <section className="panel">
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
          </section>}

          <section className="panel">
            <h2>Источники переходов</h2>
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
                    <td>{labels[point.event]}</td>
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
