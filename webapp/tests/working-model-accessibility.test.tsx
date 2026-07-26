import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkingModelPanel } from '../src/features/tender/WorkingModelPanel'
import { ModelAnalysisPanel } from '../src/features/tender/ModelAnalysisPanel'
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
  expect(html).toContain('aria-label="Aster: гипотеза, полярность Положительная"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('aria-label="Aster: заметка"')
})

test('Working Model remains editable while the phase action is waiting for another player', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ModelAnalysisPanel
        disabled
        workingModelDisabled={false}
        dueAt="2026-07-25T12:01:30.000Z"
        knownSignals={['aster']}
        maxTheses={1}
        model={{ signals: {} }}
        privateMeasurements={[]}
        publicLaboratoryResults={[]}
        publicTheses={[]}
        serverTime="2026-07-25T12:00:00.000Z"
        onConfirmThesis={async () => undefined}
        onSaveWorkingModel={async () => undefined}
      />
    </I18nProvider>,
  )

  const fieldButton = html.match(/<button[^>]*aria-label="Aster: гипотеза, тип поля Инерционное"[^>]*>/)?.[0]

  expect(fieldButton).toBeDefined()
  expect(fieldButton).not.toContain('disabled')
  const thesisSelect = html.match(/<select[^>]*aria-label="Сигнал для тезиса"[^>]*>/)?.[0]
  expect(thesisSelect).toContain('disabled')
})
