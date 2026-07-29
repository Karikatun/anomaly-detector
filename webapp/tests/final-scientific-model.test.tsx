import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FinalScientificModelPanel } from '../src/features/tender/FinalScientificModelPanel'
import { I18nProvider } from '../src/platform/i18n'

test('Final Scientific Model restores its private server draft and aggregate progress', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <FinalScientificModelPanel
        draft={{
          signals: {
            aster: { fieldType: 'inertial', polarity: 'negative' },
          },
        }}
        dueAt="2026-07-29T12:03:00.000Z"
        evidence={{
          privateMeasurements: [],
          publicLaboratoryResults: [],
          publicTheses: [],
        }}
        onConfirm={async () => undefined}
        onSaveDraft={async () => undefined}
        progress={{ completed: 1, total: 2 }}
        serverTime="2026-07-29T12:00:00.000Z"
        workingModel={{
          signals: {
            aster: { note: 'Проверить полярность' },
          },
        }}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Подтвердили 1 из 2 исследователей')
  expect(html).toContain('aria-label="Aster: тип поля Инерционное"')
  expect(html).toContain('aria-label="Aster: полярность Отрицательная"')
  expect(html.match(/data-selected=""/g)).toHaveLength(2)
  expect(html).toContain('Рабочая модель и заметки')
})

test('submitted Final Scientific Model is locked and server-confirmed', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <FinalScientificModelPanel
        draft={{ signals: {} }}
        dueAt="2026-07-29T12:03:00.000Z"
        evidence={{
          privateMeasurements: [],
          publicLaboratoryResults: [],
          publicTheses: [],
        }}
        onConfirm={async () => undefined}
        onSaveDraft={async () => undefined}
        progress={{ completed: 1, total: 2 }}
        serverTime="2026-07-29T12:00:00.000Z"
        submitted
        workingModel={{ signals: {} }}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Финальная модель отправлена')
  expect(html).toContain('disabled=""')
})
