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
        onConfirm={async () => undefined}
        onSaveDraft={async () => undefined}
        progress={{ completed: 1, total: 2 }}
        serverTime="2026-07-29T12:00:00.000Z"
      />
    </I18nProvider>,
  )

  expect(html).toContain('Подтвердили 1 из 2 исследователей')
  expect(html).toContain('aria-label="Aster: тип поля Инерционное"')
  expect(html).toContain('aria-label="Aster: полярность Отрицательная"')
  expect(html.match(/data-selected=""/g)).toHaveLength(2)
  expect(html).not.toContain('Рабочая модель')
})

test('Final Scientific Model exposes separate mobile selects for field type and polarity', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <FinalScientificModelPanel
        draft={{
          signals: {
            aster: { fieldType: 'inertial', polarity: 'negative' },
          },
        }}
        dueAt="2026-07-29T12:03:00.000Z"
        onConfirm={async () => undefined}
        onSaveDraft={async () => undefined}
        serverTime="2026-07-29T12:00:00.000Z"
      />
    </I18nProvider>,
  )

  expect(html.match(/data-final-model-mobile-select=""/g)).toHaveLength(12)
  expect(html.match(/data-final-model-signal-row=""/g)).toHaveLength(6)
  expect(html.match(/data-final-model-mobile-controls=""/g)).toHaveLength(6)
  expect(html).toContain('aria-label="Aster: тип поля"')
  expect(html).toContain('aria-label="Aster: полярность"')
  expect(html).toMatch(/<option[^>]*value="">Не выбрано<\/option>/)
  expect(html).toMatch(/<option[^>]*value="inertial" selected="">Инерционное<\/option>/)
  expect(html).toMatch(/<option[^>]*value="negative" selected="">Отрицательная<\/option>/)
  expect(html).not.toContain('href="#final-evidence"')
  expect(html).not.toContain('id="final-evidence"')
})

test('submitted Final Scientific Model is locked and server-confirmed', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <FinalScientificModelPanel
        draft={{
          signals: {
            aster: { fieldType: 'inertial', polarity: 'negative' },
            boreal: { fieldType: 'inertial', polarity: 'positive' },
            cinder: { fieldType: 'electromagnetic', polarity: 'negative' },
            delta: { fieldType: 'phase', polarity: 'negative' },
            eclipse: { fieldType: 'electromagnetic', polarity: 'positive' },
            ferro: { fieldType: 'phase', polarity: 'positive' },
          },
        }}
        dueAt="2026-07-29T12:03:00.000Z"
        onConfirm={async () => undefined}
        onSaveDraft={async () => undefined}
        progress={{ completed: 1, total: 2 }}
        serverTime="2026-07-29T12:00:00.000Z"
        submitted
      />
    </I18nProvider>,
  )

  expect(html).toContain('Финальная модель отправлена · 12/12')
  expect(html).toContain('aria-label="Заполнено параметров: 12 из 12"')
  expect(html.match(/data-selected=""/g)).toHaveLength(12)
  expect(html).toContain('disabled=""')
})
