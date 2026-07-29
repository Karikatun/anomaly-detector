import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkingModelPanel } from '../src/features/tender/WorkingModelPanel'
import { ModelAnalysisPanel } from '../src/features/tender/ModelAnalysisPanel'
import { I18nProvider } from '../src/platform/i18n'

test('Working Model exposes only reversible field-type and polarity hypotheses', () => {
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

  expect(html).toContain('aria-label="Aster: гипотеза, тип поля Инерционное"')
  expect(html).toContain('aria-label="Aster: гипотеза, полярность Положительная"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).not.toContain('гипотеза, тип поля не выбрано')
  expect(html).not.toContain('гипотеза, полярность не выбрано')
  expect(html).not.toContain('Метки')
  expect(html).not.toContain('aria-label="Aster: заметка"')
})

test('Working Model remains editable while the phase action is waiting for another player', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ModelAnalysisPanel
        disabled
        workingModelDisabled={false}
        knownSignals={['aster']}
        maxTheses={1}
        model={{ signals: {} }}
        publicTheses={[]}
        round={1}
        onConfirmThesis={async () => undefined}
        onFinish={async () => undefined}
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

test('Model Analysis renders every public Thesis in its history', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ModelAnalysisPanel
        knownSignals={['aster']}
        maxTheses={1}
        model={{ signals: {} }}
        publicTheses={[
          { correct: true, fieldType: 'inertial', playerId: 'player-a', polarity: 'positive', signalId: 'aster', verification: 'standard' },
          { correct: false, fieldType: 'phase', playerId: 'player-a', polarity: 'positive', signalId: 'aster', verification: 'standard' },
          { correct: false, fieldType: 'electromagnetic', playerId: 'player-a', polarity: 'positive', signalId: 'aster', verification: 'standard' },
          { correct: true, fieldType: 'inertial', playerId: 'player-a', polarity: 'negative', signalId: 'aster', verification: 'extended' },
        ]}
        round={1}
        onConfirmThesis={async () => undefined}
        onFinish={async () => undefined}
        onSaveWorkingModel={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html.match(/data-public-thesis="true"/g)).toHaveLength(4)
})

test('private Model Analysis shows separate property results only to its owner', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ModelAnalysisPanel
        knownSignals={['aster']}
        maxTheses={2}
        model={{ signals: {} }}
        privateTheses={[
          {
            fieldType: 'phase',
            fieldTypeCorrect: false,
            fullyCorrect: false,
            id: 'r1-player-a-thesis-1',
            polarity: 'negative',
            polarityCorrect: true,
            round: 1,
            signalId: 'aster',
          },
          {
            fieldType: 'inertial',
            fieldTypeCorrect: true,
            fullyCorrect: false,
            id: 'r2-player-a-thesis-1',
            polarity: 'positive',
            polarityCorrect: false,
            round: 2,
            signalId: 'aster',
          },
        ]}
        progress={{ completed: 1, total: 2 }}
        publicTheses={[]}
        round={2}
        ruleset="tender-v2"
        onConfirmThesis={async () => undefined}
        onFinish={async () => undefined}
        onSaveWorkingModel={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html.match(/data-private-thesis="true"/g)).toHaveLength(2)
  expect(html).toContain('Тип верен')
  expect(html).toContain('Полярность неверна')
  expect(html).toContain('Завершить анализ')
  expect(html).toContain('Завершили 1 из 2 исследователей')
  expect(html).not.toContain('data-public-thesis="true"')
  expect(html).not.toContain('История лаборатории')
})
