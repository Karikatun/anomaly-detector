import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { TenderView } from '@anomaly-detector/contracts'

import {
  TenderEvidence,
  TenderLaboratoryJournal,
  TenderResearchData,
} from '../src/features/tender/components/TenderOverview'
import { I18nProvider } from '../src/platform/i18n'

const view = {
  privateMeasurements: [{
    receiverSignal: 'boreal',
    sourceSignal: 'aster',
    polarityRelation: 'same',
  }],
  publicLaboratoryResults: [{
    playerId: 'player-a',
    protocol: 'continuous',
    publicResult: 'reflection',
    receiverSignal: 'boreal',
    sourceSignal: 'aster',
  }],
  publicTheses: [],
} as TenderView

test('labels Laboratory results as public and the current player measurement as private', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderEvidence data={view} />
    </I18nProvider>,
  )

  expect(html).toContain('Результаты лаборатории')
  expect(html).toContain('Личные измерения')
  expect(html).toContain('Одинаковая полярность')
})

test('keeps Laboratory protocol details out of the public journal presentation', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderLaboratoryJournal
        players={[{ budget: 2, displayName: 'TestPlayer1', playerId: 'player-a', rating: 0 }]}
        results={view.publicLaboratoryResults}
      />
      <TenderEvidence data={view} />
    </I18nProvider>,
  )

  expect(html).toContain('TestPlayer1')
  expect(html).not.toContain('Непрерывный')
  expect(html).not.toContain('Импульсный')
})

test('includes the current player private Thesis history in Research Data', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderResearchData
        view={{
          ...view,
          privateTheses: [{
            fieldType: 'inertial',
            fieldTypeCorrect: true,
            fullyCorrect: false,
            id: 'round-2-player-a-thesis-1',
            polarity: 'negative',
            polarityCorrect: false,
            round: 2,
            signalId: 'aster',
          }],
        }}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Личные тезисы')
  expect(html).toContain('Тип верен')
  expect(html).toContain('Полярность неверна')
})
