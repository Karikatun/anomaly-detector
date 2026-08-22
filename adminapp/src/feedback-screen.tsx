import { useRef, useState, type FormEvent } from 'react'

import type {
  FeedbackDeleteContactCommand,
  FeedbackQueueResponse,
  FeedbackRecordGithubIssueCommand,
  FeedbackRejectCommand,
  FeedbackReport,
  FeedbackResolveCommand,
  FeedbackTakeCommand,
} from '@anomaly-detector/contracts'

import { AdminApiError } from './api'

type FeedbackScreenProps = {
  data: FeedbackQueueResponse
  onBack: () => void
  onDeleteContact: (reportId: string, command: FeedbackDeleteContactCommand) => Promise<void>
  onLogout: () => void
  onPageChange: (page: number) => void
  onRecordGithubIssue: (reportId: string, command: FeedbackRecordGithubIssueCommand) => Promise<void>
  onReject: (reportId: string, command: FeedbackRejectCommand) => Promise<void>
  onReload: () => Promise<void>
  onResolve: (reportId: string, command: FeedbackResolveCommand) => Promise<void>
  onTake: (reportId: string, command: FeedbackTakeCommand) => Promise<void>
}

type CommandFeedback = { kind: 'error' | 'success'; message: string }

export function FeedbackScreen({
  data,
  onBack,
  onDeleteContact,
  onLogout,
  onPageChange,
  onRecordGithubIssue,
  onReject,
  onReload,
  onResolve,
  onTake,
}: FeedbackScreenProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null)
  const retainedCommands = useRef(new Map<string, unknown>())

  const runCommand = async <Command,>(
    key: string,
    createCommand: () => Command,
    operation: (command: Command) => Promise<void>,
    successMessage: string,
  ) => {
    const command = (retainedCommands.current.get(key) as Command | undefined) ?? createCommand()
    retainedCommands.current.set(key, command)
    setBusy(key)
    setFeedback(null)
    try {
      await operation(command)
      retainedCommands.current.delete(key)
      setFeedback({ kind: 'success', message: successMessage })
    } catch (error) {
      if (!shouldRetainFeedbackCommand(error)) retainedCommands.current.delete(key)
      setFeedback({ kind: 'error', message: commandErrorMessage(error) })
      if (error instanceof AdminApiError && error.status === 409) {
        await onReload().catch(() => undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="screen">
      <div className="content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Защищённый контур · ограниченные команды</p>
            <h1>Очередь обратной связи</h1>
            <p className="updated-at">{data.totalItems} обращений · страница {data.page} из {data.totalPages}</p>
          </div>
          <div className="header-actions">
            <button type="button" className="button button-secondary" onClick={onBack}>Системный обзор</button>
            <button type="button" className="button" onClick={() => void onReload()}>Обновить</button>
            <button type="button" className="button button-secondary" onClick={onLogout}>Выйти</button>
          </div>
        </header>

        {feedback && (
          <p
            className={`command-feedback command-feedback-${feedback.kind}`}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            {feedback.message}
          </p>
        )}

        <section className="feedback-queue" aria-label="Обращения игроков">
          {data.items.length === 0 && (
            <div className="panel"><p className="empty-copy">В очереди пока нет обращений.</p></div>
          )}
          {data.items.map((report) => (
            <article className="panel feedback-report" key={report.id}>
              <header className="feedback-report-header">
                <div>
                  <p className="eyebrow">{categoryLabel(report.category)}</p>
                  <h2>{report.publicNumber}</h2>
                  <p className="updated-at">Получено {formatDate(report.createdAt)}</p>
                </div>
                <div className="feedback-report-state">
                  <span className={`state-badge feedback-state-${report.status}`}>{statusLabel(report.status)}</span>
                  <code>v{report.version}</code>
                </div>
              </header>

              <div className="feedback-source-grid">
                <SourceContent report={report} />
                <aside className="feedback-metadata" aria-label="Безопасный технический контекст">
                  <h3>Контекст</h3>
                  <dl>
                    <div><dt>Маршрут</dt><dd><code>{report.technicalContext.routeTemplate}</code></dd></div>
                    <div><dt>Сборка</dt><dd><code>{report.technicalContext.buildSha ?? 'нет данных'}</code></dd></div>
                    <div><dt>Устройство</dt><dd>{report.technicalContext.deviceClass}</dd></div>
                    <div><dt>Браузер</dt><dd>{report.technicalContext.browserClass}</dd></div>
                    <div><dt>error_id</dt><dd><code>{report.technicalContext.errorId ?? 'нет'}</code></dd></div>
                  </dl>
                  <h3>Добровольные данные</h3>
                  <dl>
                    <div><dt>Контакт</dt><dd>{report.replyEmail ?? 'не предоставлен'}</dd></div>
                    <div><dt>Связь с аккаунтом</dt><dd><code>{report.linkedAccountId ?? 'не разрешена'}</code></dd></div>
                  </dl>
                </aside>
              </div>

              <div className="feedback-command-area">
                <p className="form-help">Исходный текст и автор не редактируются. Команды используют commandId и текущую версию.</p>
                <div className="feedback-quick-actions">
                  {report.status === 'new' && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy !== null}
                      onClick={() => void runCommand(
                        `${report.id}:take`,
                        () => ({ commandId: crypto.randomUUID(), expectedVersion: report.version }),
                        (command) => onTake(report.id, command),
                        'Обращение взято в работу',
                      )}
                    >
                      Взять в работу
                    </button>
                  )}
                  {report.status === 'in_review' && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy !== null}
                      onClick={() => void runCommand(
                        `${report.id}:resolve`,
                        () => ({ commandId: crypto.randomUUID(), expectedVersion: report.version }),
                        (command) => onResolve(report.id, command),
                        'Обращение решено',
                      )}
                    >
                      Отметить решённым
                    </button>
                  )}
                  {report.replyEmail && (
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm('Безвозвратно удалить добровольный контакт из обращения?')) return
                        void runCommand(
                          `${report.id}:delete-contact`,
                          () => ({ commandId: crypto.randomUUID(), expectedVersion: report.version }),
                          (command) => onDeleteContact(report.id, command),
                          'Добровольный контакт удалён',
                        )
                      }}
                    >
                      Удалить контакт
                    </button>
                  )}
                </div>

                {['new', 'in_review'].includes(report.status) && (
                  <RejectForm
                    busy={busy !== null}
                    onSubmit={(reason) => runCommand(
                      `${report.id}:reject`,
                      () => ({
                        commandId: crypto.randomUUID(),
                        expectedVersion: report.version,
                        reason,
                      }),
                      (command) => onReject(report.id, command),
                      'Обращение отклонено',
                    )}
                  />
                )}
                {report.status === 'in_review' && report.githubIssueNumber === null && (
                  <GithubIssueForm
                    busy={busy !== null}
                    onSubmit={(githubIssueNumber) => runCommand(
                      `${report.id}:github-issue`,
                      () => ({
                        commandId: crypto.randomUUID(),
                        expectedVersion: report.version,
                        githubIssueNumber,
                      }),
                      (command) => onRecordGithubIssue(report.id, command),
                      'Номер GitHub Issue записан',
                    )}
                  />
                )}
                {report.githubIssueNumber !== null && (
                  <p className="feedback-transfer">Передано вручную в GitHub Issue #{report.githubIssueNumber}</p>
                )}
              </div>
            </article>
          ))}
        </section>

        <nav className="pagination feedback-pagination" aria-label="Страницы обращений">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null || data.page === 1}
            onClick={() => onPageChange(data.page - 1)}
          >
            Назад
          </button>
          <span>Страница {data.page} из {data.totalPages}</span>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null || data.page === data.totalPages}
            onClick={() => onPageChange(data.page + 1)}
          >
            Далее
          </button>
        </nav>
      </div>
    </main>
  )
}

function SourceContent({ report }: { report: FeedbackReport }) {
  if (report.category === 'error') {
    return (
      <section className="feedback-source">
        <SourceField label="Что произошло" value={report.whatHappened} />
        <SourceField label="Как повторить" value={report.reproductionSteps} />
        <SourceField label="Ожидаемый результат" value={report.expectedResult} />
        <SourceField label="Можно продолжить" value={report.canContinue ? 'да' : 'нет'} />
      </section>
    )
  }
  return (
    <section className="feedback-source">
      <SourceField label="Предлагаемое изменение" value={report.desiredChange} />
      <SourceField label="Решаемая проблема" value={report.problemSolved} />
    </section>
  )
}

function SourceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h3>{label}</h3>
      <p>{value}</p>
    </div>
  )
}

function RejectForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (reason: string) => Promise<void>
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void onSubmit(String(form.get('reason') ?? ''))
  }
  return (
    <form className="feedback-inline-form" onSubmit={submit}>
      <label>Причина отклонения<textarea name="reason" minLength={3} maxLength={500} required /></label>
      <button type="submit" className="button button-danger" disabled={busy}>Отклонить с причиной</button>
    </form>
  )
}

function GithubIssueForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (number: number) => Promise<void>
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void onSubmit(Number(form.get('githubIssueNumber')))
  }
  return (
    <form className="feedback-inline-form feedback-github-form" onSubmit={submit}>
      <label>Номер вручную созданного GitHub Issue<input name="githubIssueNumber" type="number" min={1} max={2_147_483_647} required /></label>
      <button type="submit" className="button button-secondary" disabled={busy}>Записать номер</button>
    </form>
  )
}

function shouldRetainFeedbackCommand(error: unknown) {
  return error instanceof AdminApiError && error.status >= 500
}

function commandErrorMessage(error: unknown) {
  if (!(error instanceof AdminApiError)) return 'Команда не выполнена. Безопасный повтор использует тот же commandId.'
  if (error.status === 409) return 'Состояние изменилось или commandId конфликтует. Очередь обновлена.'
  return 'Команда не выполнена. Безопасный повтор использует тот же commandId.'
}

function categoryLabel(category: FeedbackReport['category']) {
  return category === 'error' ? 'Ошибка' : 'Предложение'
}

function statusLabel(status: FeedbackReport['status']) {
  if (status === 'new') return 'Новое'
  if (status === 'in_review') return 'В работе'
  if (status === 'resolved') return 'Решено'
  return 'Отклонено'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}
