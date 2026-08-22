import type { AdminOverview } from '@anomaly-detector/contracts'

type OverviewScreenProps = {
  data: AdminOverview
  isRefreshing: boolean
  onLogout: () => void
  onOpenFeedback: () => void
  onOpenMailPolicy: () => void
  onPageChange: (page: number) => void
  onRefresh: () => void
}

const roomLabels: Record<keyof AdminOverview['roomsByStatus'], string> = {
  waiting: 'Ожидают игроков',
  active: 'Идут сейчас',
  completed: 'Завершены',
}

export function OverviewScreen({ data, isRefreshing, onLogout, onOpenFeedback, onOpenMailPolicy, onPageChange, onRefresh }: OverviewScreenProps) {
  const totals = [
    ['Пользователи', data.totals.users],
    ['Активные сессии', data.totals.activeSessions],
    ['Комнаты', data.totals.rooms],
    ['Тендеры', data.totals.tenders],
  ] as const

  return (
    <main className="screen">
      <div className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Отдельный контур · только чтение</p>
            <h1>Системный обзор</h1>
            <p className="updated-at">Сформирован {formatDate(data.generatedAt)}</p>
          </div>
          <div className="header-actions">
            <button type="button" className="button button-secondary" onClick={onOpenFeedback}>Обратная связь</button>
            <button type="button" className="button button-secondary" onClick={onOpenMailPolicy}>Политика почты</button>
            <button type="button" className="button" disabled={isRefreshing} onClick={onRefresh}>
              {isRefreshing ? 'Обновляем…' : 'Обновить'}
            </button>
            <button type="button" className="button button-secondary" onClick={onLogout}>Выйти</button>
          </div>
        </header>

        <section className="summary" aria-label="Общие показатели">
          {totals.map(([label, value]) => (
            <article className="metric-card" key={label}>
              <p className="label">{label}</p>
              <p className="metric-value">{value}</p>
            </article>
          ))}
        </section>

        <div className="details">
          <section className="panel">
            <h2>Комнаты</h2>
            <div className="status-list">
              {Object.entries(data.roomsByStatus).map(([status, count]) => (
                <div className="status-row" key={status}>
                  <span>{roomLabels[status as keyof AdminOverview['roomsByStatus']]}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Тендеры по фазам</h2>
            <div className="status-list">
              {data.tendersByPhase.length === 0 && <p className="label">Тендеров пока нет</p>}
              {data.tendersByPhase.map((item) => (
                <div className="status-row" key={item.phase}>
                  <span>{item.phase}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel">
          <h2>Все пользователи</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Логин</th><th>Имя</th><th>UUID</th><th>Создан</th></tr></thead>
              <tbody>
                {data.users.items.map((user) => (
                  <tr key={user.id}>
                    <td>{user.login}</td>
                    <td>{user.displayName ?? '—'}</td>
                    <td><code>{user.id}</code></td>
                    <td>{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
                {data.users.items.length === 0 && <tr><td colSpan={4}>Пользователей пока нет</td></tr>}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="Страницы пользователей">
            <button
              type="button"
              className="button button-secondary"
              disabled={isRefreshing || data.users.page === 1}
              onClick={() => onPageChange(data.users.page - 1)}
            >
              Назад
            </button>
            <span>Страница {data.users.page} из {data.users.totalPages}</span>
            <button
              type="button"
              className="button button-secondary"
              disabled={isRefreshing || data.users.page === data.users.totalPages}
              onClick={() => onPageChange(data.users.page + 1)}
            >
              Далее
            </button>
          </nav>
        </section>
      </div>
    </main>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}
