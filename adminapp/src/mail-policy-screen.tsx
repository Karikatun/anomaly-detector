import { useRef, useState, type FormEvent } from 'react'

import type {
  MailPolicyImportCommand,
  MailPolicyPublishCommand,
  MailPolicyStatusCommand,
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
  onImport: (command: MailPolicyImportCommand) => Promise<void>
  onLogout: () => void
  onPublish: (command: MailPolicyPublishCommand) => Promise<void>
  onReload: () => Promise<void>
}

type BusyCommand = 'import' | 'publish' | 'reload' | 'status'
type Feedback = { kind: 'error' | 'success'; message: string }

export function MailPolicyScreen({
  antiAbuse,
  data,
  onBack,
  onChangeStatus,
  onImport,
  onLogout,
  onPublish,
  onReload,
}: MailPolicyScreenProps) {
  const [busy, setBusy] = useState<BusyCommand | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const importCommand = useRef<MailPolicyImportCommand | null>(null)
  const publishCommand = useRef<MailPolicyPublishCommand | null>(null)
  const statusCommand = useRef<MailPolicyStatusCommand | null>(null)
  const candidates = data.lastSuccessfulImport?.candidates ?? []
  const entries = data.publishedPolicy?.entries ?? []

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
      if (error instanceof AdminApiError && [409, 502].includes(error.status)) {
        await onReload().catch(() => undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  const submitPublish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await runCommand(
      'publish',
      publishCommand,
      'Новая версия политики опубликована',
      () => ({
        additions: [{
          canonicalization: {
            ignoreDots: form.get('ignoreDots') === 'on',
            localPartCaseInsensitive: form.get('localPartCaseInsensitive') === 'on',
            stripPlusTag: form.get('stripPlusTag') === 'on',
          },
          emailDomain: String(form.get('emailDomain') ?? ''),
          sourceCandidateId: String(form.get('sourceCandidateId') ?? ''),
        }],
        commandId: crypto.randomUUID(),
        expectedVersion: data.currentVersion,
      }),
      onPublish,
    )
  }

  const submitStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await runCommand(
      'status',
      statusCommand,
      'Статус опубликован в новой версии',
      () => ({
        commandId: crypto.randomUUID(),
        emailDomain: String(form.get('emailDomain') ?? ''),
        expectedVersion: data.currentVersion,
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
            <button
              type="button"
              className="button"
              disabled={busy !== null}
              onClick={() => void reload()}
            >
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
            <div>
              <dt>Последнее принятие SMTP</dt>
              <dd>{formatOptionalDate(data.delivery.lastSmtpSuccessAt)}</dd>
            </div>
            <div>
              <dt>Последний успешный реестр</dt>
              <dd>{formatOptionalDate(data.delivery.registryLastSuccessfulImportAt)}</dd>
            </div>
            <div>
              <dt>Повторные сбои</dt>
              <dd>{data.delivery.circuit.consecutiveFailures}</dd>
            </div>
            <div>
              <dt>Circuit до</dt>
              <dd>{formatOptionalDate(data.delivery.circuit.openUntil)}</dd>
            </div>
          </dl>
          {data.delivery.groups.length === 0 ? (
            <p className="empty-copy">Группы меньше пяти запросов скрыты; адреса, содержимое, коды и токены здесь не показываются.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Тип письма</th><th>Сервис</th><th>Запросы</th><th>Принято SMTP</th><th>Временные</th><th>Окончательные</th></tr>
                </thead>
                <tbody>
                  {data.delivery.groups.map((group) => (
                    <tr key={`${group.templateKind}:${group.service}`}>
                      <td>{templateKindLabel(group.templateKind)}</td>
                      <td><code>{group.service}</code></td>
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

        <section className="policy-layout" aria-label="Импорт и активная политика">
          <article className="panel policy-summary-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Источник кандидатов</p>
                <h2>Реестр Роскомнадзора</h2>
              </div>
              <button
                className="button"
                type="button"
                disabled={busy !== null}
                onClick={() => void runCommand(
                  'import',
                  importCommand,
                  'Кандидаты импортированы; публикация не выполнялась',
                  () => ({ commandId: crypto.randomUUID(), expectedVersion: data.currentVersion }),
                  onImport,
                )}
              >
                {busy === 'import' ? 'Импортируем…' : 'Импортировать кандидатов'}
              </button>
            </div>
            {data.latestAttempt ? (
              <dl className="definition-grid">
                <div><dt>Результат</dt><dd>{attemptLabel(data.latestAttempt.outcome)}</dd></div>
                <div><dt>Дата источника</dt><dd>{data.latestAttempt.sourceDate ?? 'Недоступна'}</dd></div>
                <div><dt>Завершён</dt><dd>{formatDate(data.latestAttempt.finishedAt)}</dd></div>
                <div>
                  <dt>Контрольная сумма</dt>
                  <dd><code>{data.latestAttempt.checksum ? `${data.latestAttempt.checksum.slice(0, 16)}…` : 'Недоступна'}</code></dd>
                </div>
              </dl>
            ) : (
              <p className="empty-copy">Импорт ещё не запускался. Опубликованная версия при ошибке источника не меняется.</p>
            )}
            {data.latestAttempt?.failureCode && (
              <p className="inline-warning">Импорт закрыт без изменений: {failureLabel(data.latestAttempt.failureCode)}</p>
            )}
          </article>

          <article className="panel policy-summary-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Last-known-good</p>
                <h2>Опубликованная версия</h2>
              </div>
              <span className="version-badge">v{data.publishedPolicy?.version ?? 0}</span>
            </div>
            {entries.length === 0 ? (
              <p className="empty-copy">Разрешённые email-домены ещё не опубликованы.</p>
            ) : (
              <div className="policy-entry-list">
                {entries.map((entry) => (
                  <div className="policy-entry" key={entry.emailDomain}>
                    <div>
                      <code>{entry.emailDomain}</code>
                      <p>{stateLabel(entry.state)}</p>
                    </div>
                    <span className={`state-badge state-${entry.state}`}>{stateName(entry.state)}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Без автоматического whitelist</p>
              <h2>Кандидаты и diff</h2>
            </div>
            {data.lastSuccessfulImport && (
              <p className="diff-summary">
                +{data.lastSuccessfulImport.diff.added.length} · −{data.lastSuccessfulImport.diff.removed.length} · без изменений {data.lastSuccessfulImport.diff.unchangedCount}
              </p>
            )}
          </div>
          {candidates.length === 0 ? (
            <p className="empty-copy">Нет проверенного snapshot кандидатов.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Запись</th><th>Сервисный домен</th><th>Основание кандидата</th></tr></thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td><code>{candidate.registryEntryId}</code></td>
                      <td><code>{candidate.serviceDomain}</code></td>
                      <td>Описание упоминает почтовый сервис</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.lastSuccessfulImport && (data.lastSuccessfulImport.diff.added.length > 0 || data.lastSuccessfulImport.diff.removed.length > 0) && (
            <div className="diff-details">
              <DomainDiff title="Добавлены в snapshot" domains={data.lastSuccessfulImport.diff.added} />
              <DomainDiff title="Исчезли из snapshot" domains={data.lastSuccessfulImport.diff.removed} />
            </div>
          )}
        </section>

        <section className="command-grid" aria-label="Команды политики">
          <form className="panel command-panel" onChange={() => { publishCommand.current = null }} onSubmit={(event) => void submitPublish(event)}>
            <div className="panel-heading">
              <div><p className="eyebrow">Явное решение</p><h2>Опубликовать домен</h2></div>
            </div>
            <div className="command-form">
              <label>
                Кандидат из последнего snapshot
                <select name="sourceCandidateId" required disabled={candidates.length === 0 || busy !== null}>
                  <option value="">Выберите запись</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.registryEntryId} · {candidate.serviceDomain}</option>
                  ))}
                </select>
              </label>
              <label>
                Разрешаемый email-домен
                <input name="emailDomain" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="example.ru" required />
              </label>
              <fieldset>
                <legend>Подтверждённые provider-specific правила</legend>
                <label className="check-row"><input type="checkbox" name="localPartCaseInsensitive" /> Локальная часть без учёта регистра</label>
                <label className="check-row"><input type="checkbox" name="stripPlusTag" /> Убирать подтверждённый +tag</label>
                <label className="check-row"><input type="checkbox" name="ignoreDots" /> Игнорировать подтверждённые точки</label>
              </fieldset>
              <p className="form-help">Домен сервиса из реестра не подставляется как email-домен автоматически.</p>
              <button className="button" type="submit" disabled={candidates.length === 0 || busy !== null}>
                {busy === 'publish' ? 'Публикуем…' : 'Опубликовать домен'}
              </button>
            </div>
          </form>

          <form className="panel command-panel" onChange={() => { statusCommand.current = null }} onSubmit={(event) => void submitStatus(event)}>
            <div className="panel-heading">
              <div><p className="eyebrow">Отдельная команда</p><h2>Сменить статус</h2></div>
            </div>
            <div className="command-form">
              <label>
                Опубликованный email-домен
                <select name="emailDomain" required disabled={entries.length === 0 || busy !== null}>
                  <option value="">Выберите домен</option>
                  {entries.map((entry) => <option key={entry.emailDomain} value={entry.emailDomain}>{entry.emailDomain}</option>)}
                </select>
              </label>
              <label>
                Новый статус
                <select name="state" required disabled={entries.length === 0 || busy !== null}>
                  <option value="deprecated">Deprecated — запретить новые адреса</option>
                  <option value="blocked">Blocked — остановить recovery-отправку</option>
                </select>
              </label>
              <label>
                Причина для неизменяемого аудита
                <textarea name="reason" minLength={3} maxLength={500} required />
              </label>
              <button className="button button-danger" type="submit" disabled={entries.length === 0 || busy !== null}>
                {busy === 'status' ? 'Публикуем статус…' : 'Сменить статус'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}

export function RequestBudgetOverviewPanel({
  antiAbuse,
}: {
  antiAbuse: RequestBudgetOverview | null
}) {
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
                <thead>
                  <tr><th>Поверхность</th><th>Исчерпанные budget-ключи</th></tr>
                </thead>
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

function DomainDiff({ domains, title }: { domains: string[]; title: string }) {
  if (domains.length === 0) return null
  return (
    <div><h3>{title}</h3><ul>{domains.map((domain) => <li key={domain}><code>{domain}</code></li>)}</ul></div>
  )
}

function attemptLabel(outcome: MailOperationsView['latestAttempt'] extends infer T
  ? T extends { outcome: infer O } ? O : never
  : never) {
  return outcome === 'succeeded' ? 'Кандидаты проверены' : outcome === 'rejected' ? 'Отклонён как подозрительный' : 'Ошибка источника'
}

function stateName(state: 'approved' | 'blocked' | 'deprecated') {
  return state === 'approved' ? 'Approved' : state === 'deprecated' ? 'Deprecated' : 'Blocked'
}

function stateLabel(state: 'approved' | 'blocked' | 'deprecated') {
  if (state === 'approved') return 'Новые адреса и recovery разрешены'
  if (state === 'deprecated') return 'Новые адреса запрещены; recovery продолжается'
  return 'Новые адреса и recovery-отправка остановлены'
}

function failureLabel(code: string) {
  if (code === 'suspicious_mass_removal') return 'подозрительное массовое удаление'
  if (code === 'source_unavailable') return 'официальный источник недоступен'
  return 'данные не прошли безопасную проверку'
}

function commandErrorMessage(error: unknown) {
  if (!(error instanceof AdminApiError)) return 'Команда не выполнена. Повтор использует тот же commandId.'
  if (error.status === 403) return 'Для команды нужен новый вход не старше 10 минут.'
  if (error.status === 409) return 'Состояние изменилось или commandId конфликтует. Данные обновлены; проверьте diff.'
  if (error.status === 502) return 'Источник не прошёл импорт. Активная версия сохранена.'
  return 'Команда не выполнена. Повтор использует тот же commandId.'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
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

function requestBudgetSurfaceLabel(
  surface: RequestBudgetOverview['groups'][number]['surface'],
) {
  if (surface === 'authentication') return 'Аутентификация'
  if (surface === 'transactional_mail') return 'Транзакционная почта'
  if (surface === 'room_join') return 'Вход в комнату'
  if (surface === 'tender_command') return 'Команды Тендера'
  return 'Realtime'
}
