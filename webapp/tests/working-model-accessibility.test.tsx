import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkingModelPanel } from '../src/features/tender/WorkingModelPanel'
import { I18nProvider } from '../src/platform/i18n'

test('Working Model exposes each Signal, category, marker state, and note to assistive technology', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <WorkingModelPanel
        knownSignals={['aster']}
        model={{
          signals: {
            aster: {
              possibleFieldTypes: ['inertial'],
              excludedPolarities: ['negative'],
              hypothesis: { fieldType: 'phase', polarity: 'positive' },
            },
          },
        }}
        onSave={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html).toContain('aria-label="Aster: возможные типы поля"')
  expect(html).toContain('aria-label="Aster: тип поля Инерционное, возможно"')
  expect(html).toContain('data-marker-state="excluded"')
  expect(html).toContain('aria-label="Aster: гипотеза, полярность Позитивная"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('aria-label="Aster: заметка"')
})
