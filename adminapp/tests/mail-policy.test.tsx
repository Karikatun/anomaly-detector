import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AdminApiError } from '../src/api'
import { shouldRetainCommand } from '../src/mail-policy-command-retry'
import { MailPolicyScreen, RequestBudgetOverviewPanel } from '../src/mail-policy-screen'

test('retains a command only when the outcome is ambiguous', () => {
  expect(shouldRetainCommand(new TypeError('network failure'))).toBe(true)
  expect(shouldRetainCommand(new AdminApiError(500, 'INTERNAL_ERROR', 'response failed'))).toBe(true)
  expect(shouldRetainCommand(new AdminApiError(409, 'CONFLICT', 'version changed'))).toBe(false)
})

test('renders one reviewed-catalog sync workflow and provider-level controls', () => {
  const yandex = {
    customDomain: {
      allowedZones: ['ru', 'xn--p1ai'] as const,
      mxExchanges: ['mx.yandex.net'],
    },
    displayName: 'Яндекс',
    evidenceUrl: 'https://yandex.ru/support/yandex-360/business/admin/ru/domains/dns/mx',
    providerId: 'yandex',
    publicDomains: [{
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      emailDomain: 'yandex.ru',
    }],
  }
  const regRu = {
    customDomain: {
      allowedZones: ['ru', 'xn--p1ai'] as const,
      mxExchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'],
    },
    displayName: 'REG.RU',
    evidenceUrl: 'https://help.reg.ru/support/hosting/example',
    providerId: 'reg_ru',
    publicDomains: [],
  }
  const html = renderToStaticMarkup(
    <MailPolicyScreen
      antiAbuse={{
        groups: [
          { exhaustedBudgetKeysAtLeast: 10, surface: 'authentication' },
          { exhaustedBudgetKeysAtLeast: 20, surface: 'tender_command' },
        ],
        minimumGroupSize: 10,
        roundingStep: 10,
      }}
      data={{
        availableCatalog: {
          diff: {
            addedProviderIds: ['reg_ru'],
            changedProviderIds: ['yandex'],
            removedProviderIds: [],
          },
          providers: [regRu, yandex],
          version: 1,
        },
        currentVersion: 2,
        delivery: {
          budget: { limitPerMinute: 60, usedInWindow: 7, windowStartedAt: '2026-08-25T12:00:00.000Z' },
          circuit: { consecutiveFailures: 1, openUntil: null, state: 'closed' },
          configured: true,
          groups: [{
            providerId: 'yandex',
            requested: 12,
            smtpAccepted: 10,
            templateKind: 'account_email_confirmation',
            temporaryFailures: 2,
            terminalFailures: 0,
          }],
          lastSmtpSuccessAt: '2026-08-25T11:59:00.000Z',
          outbox: { leased: 1, oldestQueuedAt: '2026-08-25T11:58:00.000Z', queued: 2 },
          provider: 'reg_ru',
          catalogLastSyncedAt: '2026-08-25T11:55:00.000Z',
          totals: { requested: 12, smtpAccepted: 10, temporaryFailures: 2, terminalFailures: 0 },
        },
        generatedAt: '2026-08-25T12:00:00.000Z',
        publishedPolicy: {
          catalogVersion: 1,
          providers: [
            { ...regRu, reason: null, state: 'approved' },
            { ...yandex, reason: 'Новые привязки остановлены', state: 'deprecated' },
          ],
          publishedAt: '2026-08-25T11:58:00.000Z',
          version: 2,
        },
      }}
      onBack={() => undefined}
      onChangeStatus={async () => undefined}
      onLogout={() => undefined}
      onReload={async () => undefined}
      onSyncCatalog={async () => undefined}
    />,
  )

  expect(html).toContain('Проверенный каталог v1')
  expect(html).toContain('Синхронизировать каталог')
  expect(html).toContain('REG.RU')
  expect(html).toContain('mx1.hosting.reg.ru')
  expect(html).toContain('Яндекс')
  expect(html).toContain('yandex.ru')
  expect(html).toContain('первый принимающий сервис')
  expect(html).toContain('Сменить статус провайдера')
  expect(html).toContain('Новые адреса запрещены')
  expect(html).toContain('Состояние отправки')
  expect(html).toContain('это не подтверждение доставки в ящик')
  expect(html).toContain('Anti-abuse budgets')
  expect(html).not.toMatch(/Роскомнадзор|кандидат|импорт|Опубликовать домен/i)
  expect(html).not.toContain('anomaly-detector.ru')
})

test('renders the rollback compatibility state without fabricating an empty aggregate', () => {
  const html = renderToStaticMarkup(<RequestBudgetOverviewPanel antiAbuse={null} />)

  expect(html).toContain('Агрегат недоступен в этой версии')
  expect(html).not.toContain('Нет широких групп')
})
