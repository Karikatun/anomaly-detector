import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AdminApiError } from '../src/api'
import { shouldRetainCommand } from '../src/mail-policy-command-retry'
import { MailPolicyScreen, RequestBudgetOverviewPanel } from '../src/mail-policy-screen'

test('retains a command only when the outcome is ambiguous', () => {
  expect(shouldRetainCommand(new TypeError('network failure'))).toBe(true)
  expect(shouldRetainCommand(new AdminApiError(500, 'INTERNAL_ERROR', 'response failed'))).toBe(true)
  expect(shouldRetainCommand(new AdminApiError(409, 'CONFLICT', 'version changed'))).toBe(false)
  expect(shouldRetainCommand(new AdminApiError(502, 'INTERNAL_ERROR', 'source rejected'))).toBe(false)
})

test('renders candidate evidence and only the three approved operator workflows', () => {
  const html = renderToStaticMarkup(
    <MailPolicyScreen
      antiAbuse={{
        groups: [
          {
            exhaustedBudgetKeysAtLeast: 10,
            surface: 'authentication',
          },
          {
            exhaustedBudgetKeysAtLeast: 20,
            surface: 'tender_command',
          },
        ],
        minimumGroupSize: 10,
        roundingStep: 10,
      }}
      data={{
        currentVersion: 2,
        delivery: {
          budget: { limitPerMinute: 60, usedInWindow: 7, windowStartedAt: '2026-08-22T12:00:00.000Z' },
          circuit: { consecutiveFailures: 1, openUntil: null, state: 'closed' },
          configured: true,
          groups: [{
            requested: 12,
            service: 'mail.yandex.ru',
            smtpAccepted: 10,
            templateKind: 'account_email_confirmation',
            temporaryFailures: 2,
            terminalFailures: 0,
          }],
          lastSmtpSuccessAt: '2026-08-22T11:59:00.000Z',
          outbox: { leased: 1, oldestQueuedAt: '2026-08-22T11:58:00.000Z', queued: 2 },
          provider: 'reg_ru',
          registryLastSuccessfulImportAt: '2026-08-22T11:55:00.000Z',
          totals: { requested: 12, smtpAccepted: 10, temporaryFailures: 2, terminalFailures: 0 },
        },
        generatedAt: '2026-08-22T12:00:00.000Z',
        latestAttempt: {
          checksum: 'a'.repeat(64),
          failureCode: null,
          finishedAt: '2026-08-22T11:55:00.000Z',
          id: '019f8099-7e26-7760-ad08-66d1d66b2760',
          outcome: 'succeeded',
          sourceDate: '2026-08-20',
          sourceUrl: 'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data.xml',
        },
        lastSuccessfulImport: {
          candidates: [{
            evidence: 'service_description_mentions_mail',
            id: '019f8099-7e26-7760-ad08-66d1d66b2761',
            registryEntryId: '1-PP',
            serviceDomain: 'mail.yandex.ru',
          }],
          diff: { added: ['mail.yandex.ru'], removed: [], unchangedCount: 0 },
          importId: '019f8099-7e26-7760-ad08-66d1d66b2760',
        },
        publishedPolicy: {
          entries: [{
            canonicalization: {
              ignoreDots: false,
              localPartCaseInsensitive: true,
              stripPlusTag: false,
            },
            emailDomain: 'yandex.ru',
            reason: 'Новые привязки остановлены',
            sourceCandidateId: '019f8099-7e26-7760-ad08-66d1d66b2761',
            state: 'deprecated',
          }],
          publishedAt: '2026-08-22T11:58:00.000Z',
          version: 2,
        },
      }}
      onBack={() => undefined}
      onChangeStatus={async () => undefined}
      onImport={async () => undefined}
      onLogout={() => undefined}
      onPublish={async () => undefined}
      onReload={async () => undefined}
    />,
  )

  expect(html).toContain('Политика почтовых сервисов')
  expect(html).toContain('Импортировать кандидатов')
  expect(html).toContain('Опубликовать домен')
  expect(html).toContain('Сменить статус')
  expect(html).toContain('mail.yandex.ru')
  expect(html).toContain('yandex.ru')
  expect(html).toContain('Новые адреса запрещены')
  expect(html).toContain('Состояние отправки')
  expect(html).toContain('Принято SMTP')
  expect(html).toContain('это не подтверждение доставки в ящик')
  expect(html).toContain('Anti-abuse budgets')
  expect(html).toContain('Публичные login, registration, password-reset и Recovery Code scopes исключены')
  expect(html).toContain('Аутентификация')
  expect(html).toContain('Команды Тендера')
  expect(html).toContain('значения округлены вниз с шагом 10')
  expect(html).toContain('не менее 10')
  expect(html).toContain('не менее 20')
  expect(html).not.toContain('distributorEmail')
  expect(html).not.toContain('Редактировать запись')
  expect(html).not.toContain('Удалить запись')
})

test('renders the rollback compatibility state without fabricating an empty aggregate', () => {
  const html = renderToStaticMarkup(<RequestBudgetOverviewPanel antiAbuse={null} />)

  expect(html).toContain('Агрегат недоступен в этой версии')
  expect(html).not.toContain('Нет широких групп')
})
