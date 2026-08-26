import { useRef, useState, type FormEvent } from 'react'

import type {
  MailPolicyStatusCommand,
  MailPolicySyncCommand,
  MailOperationsView,
  RequestBudgetOverview,
} from '@anomaly-detector/contracts'

import { AdminApiError } from './api'
import { shouldRetainCommand } from './mail-policy-command-retry'

type MailPolicyScreenProps = {
  antiAbuse: RequestBudgetOverview | null
  data: MailOperationsView
  onBack: () => void
  onChangeStatus: (command: MailPolicyStatusCommand) => Promise<void>
  onLogout: () => void
  onReload: () => Promise<void>
  onSyncCatalog: (command: MailPolicySyncCommand) => Promise<void>
}

type BusyCommand = 'reload' | 'status' | 'sync'
type Feedback = { kind: 'error' | 'success'; message: string }

export function MailPolicyScreen({
  antiAbuse,
  data,
  onBack,
  onChangeStatus,
  onLogout,
  onReload,
  onSyncCatalog,
}: MailPolicyScreenProps) {
  const [busy, setBusy] = useState<BusyCommand | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const syncCommand = useRef<MailPolicySyncCommand | null>(null)
  const statusCommand = useRef<MailPolicyStatusCommand | null>(null)
  const publishedProviders = data.publishedPolicy?.providers ?? []
  const publishedById = new Map(publishedProviders.map((provider) => [provider.providerId, provider]))
  const catalogDiff = data.availableCatalog.diff
  const hasCatalogDiff = catalogDiff.addedProviderIds.length > 0
    || catalogDiff.changedProviderIds.length > 0
    || catalogDiff.removedProviderIds.length > 0

  const runCommand = async <Command,>(
    kind: BusyCommand,
    commandRef: { current: Command | null },
    successMessage: string,
    createCommand: () => Command,
    operation: (command: Command) => Promise<void>,
  ) => {
    const command = commandRef.current ?? createCommand()
    commandRef.current = command
    setBusy(kind)
    setFeedback(null)
    try {
      await operation(command)
      commandRef.current = null
      setFeedback({ kind: 'success', message: successMessage })
    } catch (error) {
      setFeedback({ kind: 'error', message: commandErrorMessage(error) })
      if (!shouldRetainCommand(error)) commandRef.current = null
      if (error instanceof AdminApiError && error.status === 409) {
        await onReload().catch(() => undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  const submitStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await runCommand(
      'status',
      statusCommand,
      'Статус провайдера опубликован в новой версии',
      () => ({
        commandId: crypto.randomUUID(),
        expectedVersion: data.currentVersion,
        providerId: String(form.get('providerId') ?? ''),
        reason: String(form.get('reason') ?? ''),
        state: String(form.get('state') ?? '') as 'blocked' | 'deprecated',
      }),
      onChangeStatus,
    )
  }

  const reload = async () => {
    setBusy('reload')
    setFeedback(null)
    try {
      await onReload()
    } catch {
      setFeedback({ kind: 'error', message: 'Состояние почтового контура не обновлено. Повторите запрос.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="screen">
      <div className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Защищённый контур · перечисленные команды</p>
            <h1>Политика почтовых сервисов</h1>
            <p className="updated-at">
              Активная версия {data.currentVersion || 'не опубликована'} · сформировано {formatDate(data.generatedAt)}
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="button" disabled={busy !== null} onClick={() => void reload()}>
              {busy === 'reload' ? 'Обновляем…' : 'Обновить контур'}
            </button>
            <button type="button" className="button button-secondary" onClick={onBack}>Системный обзор</button>
            <button type="button" className="button button-secondary" onClick={onLogout}>Выйти</button>
          </div>
        </header>

        {feedback && (
          <p className={`command-feedback command-feedback-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
            {feedback.message}
          </p>
        )}

        <section className="panel mail-operations-panel" aria-labelledby="mail-delivery-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">REG.RU · только транзакционные письма</p>
              <h2 id="mail-delivery-title">Состояние отправки</h2>
            </div>
            <span className={`state-badge state-${deliveryStateTone(data.delivery)}`}>
              {deliveryStateLabel(data.delivery)}
            </span>
          </div>
          <div className="mail-summary-grid">
            <div className="mail-metric">
              <span>В очереди</span>
              <strong>{data.delivery.outbox.queued}</strong>
              <small>{data.delivery.outbox.oldestQueuedAt
                ? `старейшее с ${formatDate(data.delivery.outbox.oldestQueuedAt)}`
                : 'ожидающих заявок нет'}</small>
            </div>
            <div className="mail-metric">
              <span>Принято SMTP</span>
              <strong>{data.delivery.totals.smtpAccepted}</strong>
              <small>это не подтверждение доставки в ящик</small>
            </div>
            <div className="mail-metric">
              <span>Отказы</span>
              <strong>{data.delivery.totals.temporaryFailures} / {data.delivery.totals.terminalFailures}</strong>
              <small>временные / окончательные</small>
            </div>
            <div className="mail-metric">
              <span>Минутный budget</span>
              <strong>{data.delivery.budget.usedInWindow} / {data.delivery.budget.limitPerMinute}</strong>
              <small>{data.delivery.outbox.leased} сейчас обрабатывается</small>
            </div>
          </div>
          <dl className="mail-health-details">
            <div><dt>Последнее принятие SMTP</dt><dd>{formatOptionalDate(data.delivery.lastSmtpSuccessAt)}</dd></div>
            <div><dt>Последняя синхронизация каталога</dt><dd>{formatOptionalDate(data.delivery.catalogLastSyncedAt)}</dd></div>
            <div><dt>Повторные сбои</dt><dd>{data.delivery.circuit.consecutiveFailures}</dd></div>
            <div><dt>Circuit до</dt><dd>{formatOptionalDate(data.delivery.circuit.openUntil)}</dd></div>
          </dl>
          {data.delivery.groups.length === 0 ? (
            <p className="empty-copy">Группы меньше пяти запросов скрыты; адреса, домены пользователей, содержимое, коды и токены здесь не показываются.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Тип письма</th><th>Провайдер</th><th>Запросы</th><th>Принято SMTP</th><th>Временные</th><th>Окончательные</th></tr>
                </thead>
                <tbody>
                  {data.delivery.groups.map((group) => (
                    <tr key={`${group.templateKind}:${group.providerId}`}>
                      <td>{templateKindLabel(group.templateKind)}</td>
                      <td><code>{group.providerId}</code></td>
                      <td>{group.requested}</td>
                      <td>{group.smtpAccepted}</td>
                      <td>{group.temporaryFailures}</td>
                      <td>{group.terminalFailures}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <RequestBudgetOverviewPanel antiAbuse={antiAbuse} />

        <section className="panel mail-operations-panel" aria-labelledby="catalog-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Проверенный каталог v{data.availableCatalog.version}</p>
              <h2 id="catalog-title">Каталог провайдеров</h2>
            </div>
            <button
              className="button"
              type="button"
              disabled={busy !== null || !hasCatalogDiff}
              onClick={() => void runCommand(
                'sync',
                syncCommand,
                `Каталог v${data.availableCatalog.version} применён`,
                () => ({ commandId: crypto.randomUUID(), expectedVersion: data.currentVersion }),
                onSyncCatalog,
              )}
            >
              {busy === 'sync' ? 'Синхронизируем…' : hasCatalogDiff ? 'Синхронизировать каталог' : 'Каталог актуален'}
            </button>
          </div>
          <p className="catalog-boundary">
            Публичные адреса сверяются по точному домену. Личные и корпоративные домены .ru/.рф допускаются автоматически только по полному MX-профилю. Это подтверждает первый принимающий сервис, но не последующую пересылку или конечное хранение; владение ящиком всё равно подтверждается одноразовым кодом.
          </p>
          <CatalogDiff data={data} />
          <div className="provider-profile-list">
            {data.availableCatalog.providers.map((provider) => {
              const published = publishedById.get(provider.providerId)
              return (
                <article className="provider-profile" key={provider.providerId}>
                  <div className="provider-profile-heading">
                    <div>
                      <h3>{provider.displayName}</h3>
                      <code>{provider.providerId}</code>
                    </div>
                    {published ? (
                      <span className={`state-badge state-${published.state}`}>{stateName(published.state)}</span>
                    ) : (
                      <span className="version-badge">Не опубликован</span>
                    )}
                  </div>
                  {published && <p className="provider-state-copy">{stateLabel(published.state)}</p>}
                  <dl className="provider-profile-details">
                    <div>
                      <dt>Публичные домены</dt>
                      <dd>{provider.publicDomains.length > 0
                        ? provider.publicDomains.map(({ emailDomain }) => emailDomain).join(', ')
                        : 'Нет'}</dd>
                    </div>
                    <div>
                      <dt>Личные домены</dt>
                      <dd>{provider.customDomain
                        ? provider.customDomain.allowedZones.map(zoneLabel).join(', ')
                        : 'Не поддерживаются профилем'}</dd>
                    </div>
                    <div>
                      <dt>Точный MX-набор</dt>
                      <dd>{provider.customDomain
                        ? provider.customDomain.mxExchanges.join(', ')
                        : 'Не применяется'}</dd>
                    </div>
                  </dl>
                  <a className="evidence-link" href={provider.evidenceUrl} rel="noreferrer" target="_blank">
                    Официальное основание
                  </a>
                  {published?.reason && <p className="inline-warning">Причина статуса: {published.reason}</p>}
                </article>
              )
            })}
          </div>
        </section>

        <form className="panel command-panel" onChange={() => { statusCommand.current = null }} onSubmit={(event) => void submitStatus(event)}>
          <div className="panel-heading">
            <div><p className="eyebrow">Отдельная аудируемая команда</p><h2>Сменить статус провайдера</h2></div>
          </div>
          <div className="command-form">
            <label>
              Опубликованный провайдер
              <select name="providerId" required disabled={publishedProviders.length === 0 || busy !== null}>
                <option value="">Выберите провайдера</option>
                {publishedProviders.map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>{provider.displayName}</option>
                ))}
              </select>
            </label>
            <label>
              Новый статус
              <select name="state" required disabled={publishedProviders.length === 0 || busy !== null}>
                <option value="deprecated">Deprecated — запретить новые адреса</option>
                <option value="blocked">Blocked — остановить recovery-отправку</option>
              </select>
            </label>
            <label>
              Причина для неизменяемого аудита
              <textarea name="reason" minLength={3} maxLength={500} required />
            </label>
            <button className="button button-danger" type="submit" disabled={publishedProviders.length === 0 || busy !== null}>
              {busy === 'status' ? 'Публикуем статус…' : 'Сменить статус провайдера'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}

function CatalogDiff({ data }: { data: MailOperationsView }) {
  const diff = data.availableCatalog.diff
  if (diff.addedProviderIds.length === 0
    && diff.changedProviderIds.length === 0
    && diff.removedProviderIds.length === 0) {
    return <p className="empty-copy">Опубликованная версия совпадает с проверенным каталогом.</p>
  }
  return (
    <div className="diff-details" aria-label="Изменения каталога">
      <ProviderDiff title="Добавятся" providerIds={diff.addedProviderIds} />
      <ProviderDiff title="Изменятся" providerIds={diff.changedProviderIds} />
      <ProviderDiff title="Удалятся" providerIds={diff.removedProviderIds} />
    </div>
  )
}

function ProviderDiff({ providerIds, title }: { providerIds: string[]; title: string }) {
  if (providerIds.length === 0) return null
  return <div><h3>{title}</h3><ul>{providerIds.map((providerId) => <li key={providerId}><code>{providerId}</code></li>)}</ul></div>
}

export function RequestBudgetOverviewPanel({ antiAbuse }: { antiAbuse: RequestBudgetOverview | null }) {
  return (
    <section className="panel mail-operations-panel" aria-labelledby="anti-abuse-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PostgreSQL · только чтение · активные окна</p>
          <h2 id="anti-abuse-title">Anti-abuse budgets</h2>
        </div>
      </div>
      {antiAbuse === null ? (
        <p className="empty-copy">Агрегат недоступен в этой версии.</p>
      ) : (
        <>
          <p className="empty-copy">
            Публичные login, registration, password-reset и Recovery Code scopes исключены. Каждая оставшаяся категория включается только от {antiAbuse.minimumGroupSize} исчерпанных budget-ключей; значения округлены вниз с шагом {antiAbuse.roundingStep}. Сами категории, HMAC-ключи и пользовательские идентификаторы не выводятся.
          </p>
          {antiAbuse.groups.length === 0 ? (
            <p className="empty-copy">Нет широких групп, прошедших порог отображения в активных окнах.</p>
          ) : (
            <div className="table-wrap">
              <table className="anti-abuse-table">
                <thead><tr><th>Поверхность</th><th>Исчерпанные budget-ключи</th></tr></thead>
                <tbody>
                  {antiAbuse.groups.map((group) => (
                    <tr key={group.surface}>
                      <td>{requestBudgetSurfaceLabel(group.surface)}</td>
                      <td>не менее {group.exhaustedBudgetKeysAtLeast}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function stateName(state: 'approved' | 'blocked' | 'deprecated') {
  return state === 'approved' ? 'Approved' : state === 'deprecated' ? 'Deprecated' : 'Blocked'
}

function stateLabel(state: 'approved' | 'blocked' | 'deprecated') {
  if (state === 'approved') return 'Новые адреса и recovery разрешены'
  if (state === 'deprecated') return 'Новые адреса запрещены; recovery продолжается'
  return 'Новые адреса и recovery-отправка остановлены'
}

function commandErrorMessage(error: unknown) {
  if (!(error instanceof AdminApiError)) return 'Команда не выполнена. Повтор использует тот же commandId.'
  if (error.status === 403) return 'Для команды нужен новый вход не старше 10 минут.'
  if (error.status === 409) return 'Состояние или версия каталога изменились. Данные обновлены; проверьте diff и повторите команду.'
  return 'Команда не выполнена. Повтор использует тот же commandId.'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : 'Нет данных'
}

function deliveryStateLabel(delivery: MailOperationsView['delivery']) {
  if (!delivery.configured) return 'Отключено'
  if (delivery.circuit.state === 'open') return 'Circuit открыт'
  return 'Включено'
}

function deliveryStateTone(delivery: MailOperationsView['delivery']) {
  if (!delivery.configured) return 'deprecated'
  if (delivery.circuit.state === 'open') return 'blocked'
  return 'approved'
}

function templateKindLabel(kind: MailOperationsView['delivery']['groups'][number]['templateKind']) {
  if (kind === 'account_email_confirmation') return 'Подтверждение почты'
  if (kind === 'password_recovery') return 'Восстановление пароля'
  return 'Security-уведомление'
}

function requestBudgetSurfaceLabel(surface: RequestBudgetOverview['groups'][number]['surface']) {
  if (surface === 'authentication') return 'Аутентификация'
  if (surface === 'transactional_mail') return 'Транзакционная почта'
  if (surface === 'room_join') return 'Вход в комнату'
  if (surface === 'tender_command') return 'Команды Тендера'
  return 'Realtime'
}

function zoneLabel(zone: 'ru' | 'xn--p1ai') {
  return zone === 'ru' ? '.ru' : '.рф'
}
