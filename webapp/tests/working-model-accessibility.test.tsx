import { expect, test } from 'bun:test'
import type { PrivateThesis, PublicThesis } from '@anomaly-detector/contracts'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkingModelPanel } from '../src/features/tender/WorkingModelPanel'
import { ModelAnalysisPanel } from '../src/features/tender/ModelAnalysisPanel'
import { TenderEvidence } from '../src/features/tender/components/TenderOverview'
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

test('Model Analysis keeps its Thesis command while every public record is shown only in Research', () => {
  const publicTheses: PublicThesis[] = [
    { correct: true, fieldType: 'inertial', playerId: 'player-a', polarity: 'positive', signalId: 'aster', verification: 'standard' },
    { correct: false, fieldType: 'phase', playerId: 'player-a', polarity: 'positive', signalId: 'aster', verification: 'standard' },
    { correct: false, fieldType: 'electromagnetic', playerId: 'player-a', polarity: 'positive', signalId: 'aster', verification: 'standard' },
    { correct: true, fieldType: 'inertial', playerId: 'player-a', polarity: 'negative', signalId: 'aster', verification: 'extended' },
  ]
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ModelAnalysisPanel
        knownSignals={['aster']}
        maxTheses={1}
        model={{ signals: {} }}
        publicTheses={publicTheses}
        round={1}
        onConfirmThesis={async () => undefined}
        onFinish={async () => undefined}
        onSaveWorkingModel={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html).not.toContain('data-public-thesis')
  expect(html).toContain('aria-label="Сигнал для тезиса"')
  const research = renderToStaticMarkup(<I18nProvider><TenderEvidence data={{ privateMeasurements: [], publicLaboratoryResults: [], publicTheses }} /></I18nProvider>)
  expect(research.match(/data-public-thesis="true"/g)).toHaveLength(4)
})

test('private Model Analysis keeps readiness while separate property results remain only in Research', () => {
  const privateTheses: PrivateThesis[] = [
    { fieldType: 'phase', fieldTypeCorrect: false, fullyCorrect: false, id: 'r1-player-a-thesis-1', polarity: 'negative', polarityCorrect: true, round: 1, signalId: 'aster' },
    { fieldType: 'inertial', fieldTypeCorrect: true, fullyCorrect: false, id: 'r2-player-a-thesis-1', polarity: 'positive', polarityCorrect: false, round: 2, signalId: 'aster' },
  ]
  const html = renderToStaticMarkup(
    <I18nProvider>
      <ModelAnalysisPanel
        knownSignals={['aster']}
        maxTheses={2}
        model={{ signals: {} }}
        privateTheses={privateTheses}
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

  expect(html).not.toContain('data-private-thesis')
  expect(html).not.toContain('Тип верен')
  expect(html).not.toContain('Полярность неверна')
  const research = renderToStaticMarkup(<I18nProvider><TenderEvidence data={{ privateMeasurements: [], publicLaboratoryResults: [], publicTheses: [], privateTheses }} /></I18nProvider>)
  expect(research.match(/data-private-thesis="true"/g)).toHaveLength(2)
  expect(research).toContain('Тип верен')
  expect(research).toContain('Полярность неверна')
  expect(html).toContain('Завершить анализ')
  expect(html).toContain('Завершили 1 из 2 исследователей')
  expect(html).not.toContain('data-public-thesis="true"')
  expect(html).not.toContain('История лаборатории')
})
