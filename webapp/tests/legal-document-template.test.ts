import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  personalDataConsentVersion,
  termsVersion,
} from '@anomaly-detector/contracts'

import { applyLegalDocumentTemplate } from '../src/features/legal/legal-document-template'

test('inserts the configured public operator details into legal document placeholders', () => {
  expect(
    applyLegalDocumentTemplate(
      'Оператор: {{LEGAL_OPERATOR_NAME}}; адрес: {{LEGAL_OPERATOR_ADDRESS}}.',
      {
        address: 'Тестовый адрес',
        effectiveDate: '1 сентября 2026 года',
        name: 'Тестовый оператор',
        recipient: 'Тестовому оператору',
      },
    ),
  ).toBe('Оператор: Тестовый оператор; адрес: Тестовый адрес.')
})

test('inserts the release-controlled effective date', () => {
  expect(
    applyLegalDocumentTemplate(
      'Дата вступления в силу: {{LEGAL_DOCUMENTS_EFFECTIVE_DATE}}',
      {
        address: 'Тестовый адрес',
        effectiveDate: '1 сентября 2026 года',
        name: 'Тестовый оператор',
        recipient: 'Тестовому оператору',
      },
    ),
  ).toBe('Дата вступления в силу: 1 сентября 2026 года')
})

test('rejects a document with an unknown legal placeholder', () => {
  expect(() => applyLegalDocumentTemplate('{{LEGAL_UNKNOWN}}', {
    address: 'Тестовый адрес',
    effectiveDate: '1 сентября 2026 года',
    name: 'Тестовый оператор',
    recipient: 'Тестовому оператору',
  }))
    .toThrow('Unknown legal document placeholder')
})

test('keeps published legal revisions aligned with the implemented personal-data flows', () => {
  const audit = readFileSync(
    new URL('../../docs/audits/2026-08-23-legal-documents.md', import.meta.url),
    'utf8',
  )
  const consent = readFileSync(
    new URL('../../docs/personal-data-consent.md', import.meta.url),
    'utf8',
  )
  const privacy = readFileSync(
    new URL('../../docs/privacy-policy.md', import.meta.url),
    'utf8',
  )
  const terms = readFileSync(
    new URL('../../docs/terms-of-use.md', import.meta.url),
    'utf8',
  )

  expect(consent).toContain(`**Версия согласия:** ${personalDataConsentVersion}`)
  expect(terms).toContain(`**Версия соглашения:** ${termsVersion}`)
  expect(privacy).toContain('**Редакция:** 1.2')

  for (const document of [consent, privacy, terms]) {
    expect(document).toContain('{{LEGAL_DOCUMENTS_EFFECTIVE_DATE}}')
  }
  for (const implementedFlow of [
    'Account Email',
    'Recovery Email',
    'Feedback Report',
  ]) {
    expect(consent).toContain(implementedFlow)
    expect(privacy).toContain(implementedFlow)
    expect(terms).toContain(implementedFlow)
  }
  for (const retention of [
    '30 дней',
    '180 дней',
    '13 месяцев',
  ]) {
    expect(privacy).toContain(retention)
  }
  expect(privacy).toContain('ближайшую ежедневную очистку')

  const templateValues = {
    address: 'Тестовый адрес',
    effectiveDate: '1 сентября 2026 года',
    name: 'Тестовый оператор',
    recipient: 'Тестовому оператору',
  }
  for (const document of [consent, privacy, terms]) {
    expect(applyLegalDocumentTemplate(document, templateValues))
      .not.toMatch(/\{\{[A-Z_]+\}\}/)
  }
  expect(privacy).not.toContain('Сервис не запрашивает у поставщика номер телефона или адрес')
  expect(privacy).toContain('Условия собственной необязательной аналитики')
  expect(privacy).toContain('ООО «Айди Тех»')
  expect(consent).toContain('ООО «Айди Тех»')

  const recoveryBasis = privacy.slice(
    privacy.indexOf('### 4.6.'),
    privacy.indexOf('### 4.7.'),
  )
  expect(recoveryBasis).not.toContain('согласие пользователя')
  expect(recoveryBasis).toContain('исполнение Пользовательского соглашения')
  expect(recoveryBasis).toMatch(/законных\s+интересов/)

  const mailBasis = privacy.slice(
    privacy.indexOf('### 4.7.'),
    privacy.indexOf('### 4.8.'),
  )
  expect(mailBasis).not.toContain('согласие пользователя')
  expect(mailBasis).toContain('исполнение Пользовательского соглашения')

  const feedbackBasis = privacy.slice(
    privacy.indexOf('### 4.9.'),
    privacy.indexOf('### 4.10.'),
  )
  expect(feedbackBasis).toContain('по запросу пользователя')
  expect(feedbackBasis).toMatch(/законных\s+интересов/)

  const analyticsBasis = privacy.slice(
    privacy.indexOf('### 4.10.'),
    privacy.indexOf('## 5.'),
  )
  expect(analyticsBasis).toContain('отдельное однозначное согласие')
  expect(audit).toContain('OWNER decision: `ACCEPTED`')
  expect(audit).toContain('### Balance test для `landing_view` до выбора')
})
