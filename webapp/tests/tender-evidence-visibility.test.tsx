import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { TenderView } from '@anomaly-detector/contracts'

import { TenderEvidence } from '../src/features/tender/components/TenderOverview'
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
      <TenderEvidence view={view} />
    </I18nProvider>,
  )

  expect(html).toContain('Публичные результаты лаборатории')
  expect(html).toContain('Ваши приватные измерения')
  expect(html).toContain('Одинаковая полярность')
})
