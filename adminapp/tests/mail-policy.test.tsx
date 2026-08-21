import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AdminApiError } from '../src/api'
import { shouldRetainCommand } from '../src/mail-policy-command-retry'
import { MailPolicyScreen } from '../src/mail-policy-screen'

test('retains a command only when the outcome is ambiguous', () => {
  expect(shouldRetainCommand(new TypeError('network failure'))).toBe(true)
  expect(shouldRetainCommand(new AdminApiError(500, 'INTERNAL_ERROR', 'response failed'))).toBe(true)
  expect(shouldRetainCommand(new AdminApiError(409, 'CONFLICT', 'version changed'))).toBe(false)
  expect(shouldRetainCommand(new AdminApiError(502, 'INTERNAL_ERROR', 'source rejected'))).toBe(false)
})

test('renders candidate evidence and only the three approved operator workflows', () => {
  const html = renderToStaticMarkup(
    <MailPolicyScreen
      data={{
        currentVersion: 2,
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
  expect(html).not.toContain('distributorEmail')
  expect(html).not.toContain('Редактировать запись')
  expect(html).not.toContain('Удалить запись')
})
