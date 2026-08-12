import { expect, test } from 'bun:test'

import { applyLegalDocumentTemplate } from '../src/features/legal/legal-document-template'

test('inserts the configured public operator details into legal document placeholders', () => {
  expect(
    applyLegalDocumentTemplate(
      'Оператор: {{LEGAL_OPERATOR_NAME}}; адрес: {{LEGAL_OPERATOR_ADDRESS}}.',
      { name: 'Тестовый оператор', recipient: 'Тестовому оператору', address: 'Тестовый адрес' },
    ),
  ).toBe('Оператор: Тестовый оператор; адрес: Тестовый адрес.')
})

test('rejects a document with an unknown legal placeholder', () => {
  expect(() => applyLegalDocumentTemplate('{{LEGAL_UNKNOWN}}', { name: 'Тестовый оператор', recipient: 'Тестовому оператору', address: 'Тестовый адрес' }))
    .toThrow('Unknown legal document placeholder')
})
