import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { TenderView } from '@anomaly-detector/contracts'

import {
  TenderEvidence,
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

test('Research keeps protocol, authorship and own evidence status when histories leave the main screen', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderEvidence currentPlayerId="player-a" data={{
        ...view,
        players: [{ budget: 2, displayName: 'TestPlayer1', playerId: 'player-a', rating: 0 }, { budget: 2, displayName: 'TestPlayer2', playerId: 'player-b', rating: 0 }],
        publicScientificJournal: [
          { ...view.publicLaboratoryResults[0]!, testId: 'own-test' },
          { playerId: 'player-b', protocol: 'impulse', publicResult: 'attenuation', sourceSignal: 'boreal', receiverSignal: 'aster', testId: 'other-test' },
        ],
        privateUsedContractEvidenceTestIds: ['own-test'],
      }} />
    </I18nProvider>,
  )

  expect(html).toContain('Ваш опыт')
  expect(html).toContain('TestPlayer2')
  expect(html).toContain('Непрерывный')
  expect(html).toContain('Импульсный')
  expect(html).toContain('Доказательство использовано')
  expect(html).toContain('Видят все')
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
  expect(html).toContain('Раунд 2')
})
test('legacy public Thesis history does not invent a private round counter', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderEvidence currentPlayerId="player-a" data={{
        ...view,
        round: 2,
        players: [{ playerId: 'player-a', budget: 2, rating: 0,
          powerAllocation: { reconnaissance: 1, laboratory: 1, modelAnalysis: 2, contracts: 0 } }],
        publicTheses: [{ playerId: 'player-a', signalId: 'aster', fieldType: 'inertial',
          polarity: 'positive', verification: 'standard', correct: true }],
      }} />
    </I18nProvider>,
  )

  expect(html).toContain('Публичные тезисы')
  expect(html).toContain('Верно · Стандартная проверка')
  expect(html).not.toContain('Личные тезисы')
  expect(html).not.toContain('раунд: 0/2')
})

test('provided private Thesis history keeps total and current round counts', () => {
  const thesis = {
    fieldType: 'inertial', fieldTypeCorrect: true, fullyCorrect: true,
    polarity: 'positive', polarityCorrect: true, signalId: 'aster',
  } as const
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderEvidence currentPlayerId="player-a" data={{
        ...view,
        round: 2,
        players: [{ playerId: 'player-a', budget: 2, rating: 0,
          powerAllocation: { reconnaissance: 1, laboratory: 1, modelAnalysis: 2, contracts: 0 } }],
        privateTheses: [{ ...thesis, id: 'first-round', round: 1 }, { ...thesis, id: 'second-round', round: 2 }],
      }} />
    </I18nProvider>,
  )

  expect(html).toContain('Личные тезисы')
  expect(html).toContain('всего: 2 · раунд: 1/2')
  expect(html).toContain('Раунд 1')
  expect(html).toContain('Раунд 2')
})

test('legacy public experiments remain visible when the scientific journal is empty', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderEvidence currentPlayerId="player-a" data={{
        ...view,
        privateMeasurements: [],
        publicScientificJournal: [],
        players: [{ playerId: 'player-a', displayName: 'Legacy author', budget: 2, rating: 0 }],
      }} />
    </I18nProvider>,
  )

  expect(html).toContain('Результаты лаборатории')
  expect(html).toContain('Aster')
  expect(html).toContain('Boreal')
  expect(html).toContain('Отражение')
  expect(html).toContain('Непрерывный · Ваш опыт · Видят все')
  expect(html.match(/data-research-experiment=/g)).toHaveLength(1)
  expect(html).toContain('Публично · 1')
  expect(html).not.toContain('Доказательство использовано')
})

test('mixed legacy and scientific histories keep repeated experiments once per occurrence with available metadata', () => {
  const repeated = view.publicLaboratoryResults[0]!
  const html = renderToStaticMarkup(
    <I18nProvider>
      <TenderEvidence currentPlayerId="player-a" data={{
        ...view,
        privateMeasurements: [],
        publicLaboratoryResults: [repeated,
          { playerId: 'player-b', protocol: 'impulse', publicResult: 'attenuation', sourceSignal: 'boreal', receiverSignal: 'aster' },
          repeated],
        publicScientificJournal: [
          { ...repeated, testId: 'latest-own-test' },
          { playerId: 'player-b', protocol: 'impulse', publicResult: 'unstable_collapse', sourceSignal: 'cinder', receiverSignal: 'ferro', testId: 'journal-only-test' },
        ],
        players: [{ playerId: 'player-a', budget: 2, rating: 0 },
          { playerId: 'player-b', displayName: 'Other researcher', budget: 2, rating: 0 }],
        privateUsedContractEvidenceTestIds: ['latest-own-test'],
      }} />
    </I18nProvider>,
  )

  expect(html.match(/data-research-experiment=/g)).toHaveLength(4)
  expect(html.match(/>Отражение</g)).toHaveLength(2)
  expect(html).toContain('Ослабление')
  expect(html).toContain('Нестабильный срыв')
  expect(html).toContain('Импульсный · Other researcher · Видят все')
  expect(html.match(/Доказательство использовано/g)).toHaveLength(1)
  expect(html).toContain('Публично · 4')
})
