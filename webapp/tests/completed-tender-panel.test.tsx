import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { TenderView } from '@anomaly-detector/contracts'

import { CompletedTenderPanel } from '../src/features/tender/components/CompletedTenderPanel'
import { I18nProvider } from '../src/platform/i18n'

const view = {
  audit: {
    anomalyConfiguration: {
      seed: 'seed-1',
      signals: {
        aster: { fieldType: 'inertial', polarity: 'positive' },
        boreal: { fieldType: 'inertial', polarity: 'negative' },
        cinder: { fieldType: 'electromagnetic', polarity: 'positive' },
        delta: { fieldType: 'electromagnetic', polarity: 'negative' },
        eclipse: { fieldType: 'phase', polarity: 'positive' },
        ferro: { fieldType: 'phase', polarity: 'negative' },
      },
    },
    completionReason: 'standard',
    events: [],
    finalScientificModelsByPlayer: {
      'player-a': {
        signals: {
          aster: {
            fieldType: 'inertial',
            fieldTypeCorrect: true,
            polarity: 'negative',
            polarityCorrect: false,
          },
        },
        submitted: true,
      },
      'player-b': { signals: {}, submitted: false },
    },
    forfeitedAtByPlayer: {},
    placementByPlayer: { 'player-a': 1, 'player-b': 2 },
    privateThesesByPlayer: {
      'player-a': [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: false,
        id: 'r1-player-a-thesis-1',
        polarity: 'negative',
        polarityCorrect: false,
        round: 1,
        signalId: 'aster',
      }],
      'player-b': [],
    },
    privateMeasurementsByPlayer: {},
    publicLaboratoryResults: [],
    ratingBreakdownByPlayer: {
      'player-a': {
        completeModelBonus: 3,
        contractPoints: 4,
        correctPropertyPoints: 8,
        correctSignalPoints: 4,
        otherPoints: 0,
        thesisPoints: 2,
        total: 21,
      },
      'player-b': {
        completeModelBonus: 0,
        contractPoints: 0,
        correctPropertyPoints: 0,
        correctSignalPoints: 0,
        otherPoints: 0,
        thesisPoints: 0,
        total: 0,
      },
    },
    ruleset: 'tender-v2',
  },
  knownSignals: [],
  phase: 'complete',
  players: [
    { accessSlot: 1, budget: 3, contractPowerRestriction: 0, displayName: 'Альфа', playerId: 'player-a', rating: 21 },
    { accessSlot: 2, budget: 4, contractPowerRestriction: 0, displayName: 'Бета', playerId: 'player-b', rating: 0 },
  ],
  privateMeasurements: [],
  privateRawTelemetrySignals: [],
  privateSamples: [],
  privateWorkingModel: { signals: {} },
  publicContracts: [],
  publicLaboratoryResults: [],
  publicTheses: [],
  round: 5,
  serverTime: '2026-07-27T12:00:00.000Z',
  tenderId: 'tender-1',
  version: 1,
  winnerPlayerIds: ['player-a'],
} satisfies TenderView

test('shows what contributed to every player rating in the final audit', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <CompletedTenderPanel view={{ ...view, audit: view.audit }} />
    </I18nProvider>,
  )

  expect(html).toContain('За что начислен рейтинг')
  expect(html).toContain('Верные тезисы')
  expect(html).toContain('Выполненные контракты')
  expect(html).toContain('Верные свойства модели')
  expect(html).toContain('Полностью раскрытые сигналы')
  expect(html).toContain('Бонус полной модели')
  expect(html).toContain('Начислений рейтинга нет')
  expect(html).toContain('Приватные тезисы')
  expect(html).toContain('Тип: верно')
  expect(html).toContain('Полярность: неверно')
  expect(html).toContain('Официальные финальные модели')
  expect(html).toContain('Финальная модель не отправлена')
  expect(html).toContain('Фильтр итогового аудита по игроку')
})
