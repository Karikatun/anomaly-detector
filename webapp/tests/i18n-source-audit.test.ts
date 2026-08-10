import { expect, test } from 'bun:test'

import {
  findNewNumericMessageKeys,
  findInvalidTranslationParams,
  findUnknownTranslationKeys,
  findUntranslatedCyrillic,
  numericTranslationKeyBaseline,
} from '../scripts/i18n-source-audit.mjs'

test('allows the frozen numeric-key baseline and rejects new numeric message keys', () => {
  expect(numericTranslationKeyBaseline.size).toBe(350)
  expect(findNewNumericMessageKeys({
    allowedKeys: numericTranslationKeyBaseline,
    messageCatalog: {
      'tender.tenderPage.copy.035': 'Существующий текст',
      'tender.tenderPage.connection.reconnecting': 'Семантический новый ключ',
    },
  })).toEqual([])
  expect(findNewNumericMessageKeys({
    allowedKeys: numericTranslationKeyBaseline,
    messageCatalog: { 'tender.tenderPage.copy.036': 'Новый числовой ключ' },
  })).toEqual(['tender.tenderPage.copy.036'])
})

test('finds Cyrillic player copy in source without flagging comments or message resources', () => {
  const findings = findUntranslatedCyrillic({
    filePath: 'src/features/rooms/Room.tsx',
    source: `
      // Русский комментарий не показывается игроку
      export const Room = () => <p title="Подсказка">Комната готова</p>
    `,
  })

  expect(findings.map(({ line, text }) => ({ line, text }))).toEqual([
    { line: 3, text: 'Подсказка' },
    { line: 3, text: 'Комната готова' },
  ])

  expect(findUntranslatedCyrillic({
    filePath: 'src/platform/i18n/messages/rooms.ts',
    source: `export const roomsMessages = { 'rooms.ready': 'Комната готова' }`,
  })).toEqual([])

  expect(findUntranslatedCyrillic({
    filePath: 'src/features/legal/LegalDocumentPage.tsx',
    source: `const bodyStart = '**Версия согласия:**'`,
  })).toEqual([])
})

test('finds untranslated English copy in JSX text and accessibility attributes', () => {
  const findings = findUntranslatedCyrillic({
    filePath: 'src/components/ui/Control.tsx',
    source: `export const Control = () => <button aria-label="Retry">Close</button>`,
  })

  expect(findings.map(({ text }) => text)).toEqual(['Retry', 'Close'])
})

test('finds static translation keys that are absent from the message catalog', () => {
  const findings = findUnknownTranslationKeys({
    filePath: 'src/features/tender/Panel.tsx',
    knownKeys: new Set(['tender.panel.title']),
    source: `
      translate('tender.panel.title')
      translate('tender.panel.missing')
      t(dynamicKey)
    `,
  })

  expect(findings.map(({ line, text }) => ({ line, text }))).toEqual([
    { line: 3, text: 'tender.panel.missing' },
  ])
})

test('finds message placeholders missing from a static translation call', () => {
  const findings = findInvalidTranslationParams({
    filePath: 'src/features/tender/Panel.tsx',
    messageCatalog: { 'tender.panel.progress': 'Этап {current} из {total}' },
    source: `translate('tender.panel.progress', { current: step })`,
  })

  expect(findings.map(({ text }) => text)).toEqual([
    'tender.panel.progress: missing total',
  ])
})
