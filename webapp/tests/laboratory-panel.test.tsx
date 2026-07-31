import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  areLaboratoryPairsEqual,
  isLaboratoryPairResearched,
} from '../src/features/tender/laboratory-pair'
import { LaboratoryPanel } from '../src/features/tender/LaboratoryPanel'
import { I18nProvider } from '../src/platform/i18n'

test('requires an explicit Laboratory mode before enabling sample selection for two Power', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <LaboratoryPanel
        journal={[]}
        mySamples={['aster', 'boreal']}
        playerId="player-a"
        privateMeasurements={[]}
        powerAllocation={2}
        ruleset="tender-v2"
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Шаг 1 из 2')
  expect(html).toContain('Один непрерывный опыт')
  expect(html).toContain('Два импульсных опыта')
  expect(html).toContain('Сначала выберите тип исследования')
  expect(html.match(/<button[^>]*aria-label="Образец: Aster"[^>]*>/)?.[0]).toContain('disabled')
})

test('marks an own researched directed pair unavailable without blocking another direction', () => {
  const journal = [{
    playerId: 'player-a',
    protocol: 'continuous' as const,
    publicResult: 'reflection' as const,
    receiverSignal: 'boreal' as const,
    sourceSignal: 'aster' as const,
    testId: 'r1-t1',
  }]

  expect(isLaboratoryPairResearched({
    journal,
    playerId: 'player-a',
    receiverSignal: 'boreal',
    sourceSignal: 'aster',
  })).toBe(true)
  expect(isLaboratoryPairResearched({
    journal,
    playerId: 'player-a',
    receiverSignal: 'aster',
    sourceSignal: 'boreal',
  })).toBe(false)
  expect(isLaboratoryPairResearched({
    journal,
    playerId: 'player-b',
    receiverSignal: 'boreal',
    sourceSignal: 'aster',
  })).toBe(false)
})

test('identifies a repeated directed pair before confirming Broad research', () => {
  expect(areLaboratoryPairsEqual(
    { receiverSignal: 'boreal', sourceSignal: 'aster' },
    { receiverSignal: 'boreal', sourceSignal: 'aster' },
  )).toBe(true)
  expect(areLaboratoryPairsEqual(
    { receiverSignal: 'aster', sourceSignal: 'boreal' },
    { receiverSignal: 'boreal', sourceSignal: 'aster' },
  )).toBe(false)
})
