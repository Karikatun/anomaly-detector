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
  expect(html).toContain('Личное измерение полярности')
  expect(html).toContain('Две разные направленные пары')
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

test('shows scan-friendly sample research status and the own directed-pair history', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <LaboratoryPanel
        journal={[{
          playerId: 'player-a',
          protocol: 'continuous',
          publicResult: 'reflection',
          receiverSignal: 'boreal',
          sourceSignal: 'aster',
          testId: 'r1-t1',
        }]}
        mySamples={['aster', 'boreal', 'cinder']}
        playerId="player-a"
        privateMeasurements={[]}
        powerAllocation={2}
        ruleset="tender-v2"
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Исследовано')
  expect(html).toContain('Не исследовано')
  expect(html).toContain('Опытов: 1')
  expect(html).toContain('Ваши проведённые опыты')
  expect(html).toContain('Aster')
  expect(html).toContain('Boreal')
  expect(html).toContain('Отражение')
})

test('explains the next step when there are not enough samples', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <LaboratoryPanel
        journal={[]}
        mySamples={['aster']}
        playerId="player-a"
        privateMeasurements={[]}
        powerAllocation={1}
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Доступен только один образец')
  expect(html).toContain('Для опыта нужны два разных образца.')
})

test('shows empty and pending states without changing the Laboratory action contract', () => {
  const emptyHtml = renderToStaticMarkup(
    <I18nProvider>
      <LaboratoryPanel
        journal={[]}
        mySamples={[]}
        playerId="player-a"
        privateMeasurements={[]}
        powerAllocation={1}
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )
  const pendingHtml = renderToStaticMarkup(
    <I18nProvider>
      <LaboratoryPanel
        journal={[]}
        mySamples={['aster', 'boreal']}
        playerId="player-a"
        privateMeasurements={[]}
        powerAllocation={1}
        pending
        disabled
        onConfirm={async () => undefined}
      />
    </I18nProvider>,
  )

  expect(emptyHtml).toContain('Образцов пока нет')
  expect(emptyHtml).toContain('Получите минимум два разных образца')
  expect(pendingHtml).toContain('aria-busy="true"')
  expect(pendingHtml).toContain('Проводим опыт…')
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
