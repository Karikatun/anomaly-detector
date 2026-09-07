import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AdminApiError } from '../src/api'
import { shouldRetainCommand } from '../src/mail-policy-command-retry'
import {
  MailPolicyScreen,
  RequestBudgetOverviewPanel,
} from '../src/mail-policy-screen'
import { resolveMailProtectionAlertRunbookUrl } from '../src/mail-policy-runbook'

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
          protectionAlerts: {
            leased: 1,
            nextAttemptAt: '2026-08-25T12:01:00.000Z',
            oldestPendingAt: '2026-08-25T11:57:00.000Z',
            pending: 2,
            retrying: 1,
            terminal: 1,
          },
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

  expect(html).not.toContain('/blob/HEAD/')
  expect(html).toContain('Инструкция: docs/YANDEX_CLOUD.md#mail-protection-alert-recovery')

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
  expect(html).toContain('Оповещения защиты')
  expect(html).toContain('2 ждут отправки')
  expect(html).toContain('1 остановлен после повторных сбоев')
  expect(html).toContain('Следующая попытка')
  expect(html).toContain('Anti-abuse budgets')
  expect(html).not.toMatch(/Роскомнадзор|кандидат|импорт|Опубликовать домен/i)
  expect(html).not.toContain('anomaly-detector.ru')
})

test('pins the protection-alert runbook to the exact release revision', () => {
  const releaseSha = 'a'.repeat(40)
  expect(resolveMailProtectionAlertRunbookUrl(releaseSha)).toBe(
    `https://github.com/Karikatun/anomaly-detector/blob/${releaseSha}/docs/YANDEX_CLOUD.md#mail-protection-alert-recovery`,
  )
  expect(resolveMailProtectionAlertRunbookUrl('HEAD')).toBeNull()
  expect(resolveMailProtectionAlertRunbookUrl(undefined)).toBeNull()
})

test('renders the rollback compatibility state without fabricating an empty aggregate', () => {
  const antiAbuseHtml = renderToStaticMarkup(<RequestBudgetOverviewPanel antiAbuse={null} />)
  const mailHtml = renderToStaticMarkup(<MailPolicyScreen
    antiAbuse={null}
    data={{
      availableCatalog: {
        diff: { addedProviderIds: [], changedProviderIds: [], removedProviderIds: [] },
        providers: [],
        version: 1,
      },
      currentVersion: 0,
      delivery: {
        budget: { limitPerMinute: 60, usedInWindow: 0, windowStartedAt: null },
        circuit: { consecutiveFailures: 0, openUntil: null, state: 'disabled' },
        configured: false,
        groups: [],
        lastSmtpSuccessAt: null,
        outbox: { leased: 0, oldestQueuedAt: null, queued: 0 },
        provider: 'reg_ru',
        catalogLastSyncedAt: null,
        totals: { requested: 0, smtpAccepted: 0, temporaryFailures: 0, terminalFailures: 0 },
      },
      generatedAt: '2026-08-25T12:00:00.000Z',
      publishedPolicy: null,
    }}
    onBack={() => undefined}
    onChangeStatus={async () => undefined}
    onLogout={() => undefined}
    onReload={async () => undefined}
    onSyncCatalog={async () => undefined}
  />)

  expect(antiAbuseHtml).toContain('Агрегат недоступен в этой версии')
  expect(antiAbuseHtml).not.toContain('Нет широких групп')
  expect(mailHtml).toContain('Обновите серверную часть, чтобы увидеть состояние оповещений')
  expect(mailHtml).not.toContain('0 ждут отправки')
})
