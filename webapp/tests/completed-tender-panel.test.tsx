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
    rounds: [{
      accessSlots: [{ assignedSlot: 1, playerId: 'player-a', requestedSlot: 1, resolution: 'confirmed' }],
      contracts: [{
        conditions: {
          kind: 'complex',
          ratingReward: 4,
          requiredPublicResult: 'reflection',
          requiredSecondaryPublicResult: 'attenuation',
          targetRole: 'source',
          targetSignal: 'aster',
        },
        contractId: 'contract-1',
        evidenceTestIds: ['r1-t1'],
        evidenceTests: [{
          playerId: 'player-a',
          protocol: 'impulse',
          publicResult: 'reflection',
          receiverSignal: 'boreal',
          sourceSignal: 'aster',
          testId: 'r1-t1',
        }],
        outcome: 'awarded',
        playerId: 'player-a',
        ratingAward: 4,
      }],
      laboratory: [{
        mode: 'broad',
        playerId: 'player-a',
        resolution: 'completed',
        tests: [{
          playerId: 'player-a',
          protocol: 'impulse',
          publicResult: 'reflection',
          receiverSignal: 'boreal',
          sourceSignal: 'aster',
          testId: 'r1-t1',
          usedByContractId: 'contract-1',
        }],
      }],
      powerAllocations: [{
        allocation: {
          contracts: 1,
          laboratory: 2,
          modelAnalysis: 1,
          reconnaissance: 0,
        },
        playerId: 'player-a',
        resolution: 'confirmed',
      }],
      priorityPlayerIds: ['player-a', 'player-b'],
      ratingChanges: [{ playerId: 'player-a', points: 4, source: 'contract' }],
      reconnaissance: [{ playerId: 'player-b', resolution: 'timeout', targets: [] }],
      round: 1,
      theses: [{
        fieldType: 'inertial',
        fieldTypeCorrect: true,
        fullyCorrect: false,
        id: 'r1-player-a-thesis-1',
        playerId: 'player-a',
        polarity: 'negative',
        polarityCorrect: false,
        round: 1,
        signalId: 'aster',
      }],
    }],
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
    { accessSlot: 1, budget: 3, corporateTrust: 2, contractPowerRestriction: 0, displayName: 'Альфа', playerId: 'player-a', rating: 21 },
    { accessSlot: 2, budget: 4, corporateTrust: 1, contractPowerRestriction: 0, displayName: 'Бета', playerId: 'player-b', rating: 0 },
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
      <CompletedTenderPanel currentUserId="player-a" view={{ ...view, audit: view.audit }} />
    </I18nProvider>,
  )

  expect(html).toContain('Подробнее')
  expect(html).toContain('Верные тезисы')
  expect(html).toContain('Выполненные контракты')
  expect(html).toContain('Верные свойства модели')
  expect(html).toContain('Полностью раскрытые сигналы')
  expect(html).toContain('Бонус полной модели')
  expect(html).toContain('Начислений очков нет')
  expect(html).toContain('Приоритет при коллизии')
  expect(html).toContain('1. Альфа')
  expect(html).toContain('2. Бета')
  expect(html).toContain('Тезисы')
  expect(html).toContain('Тип поля: Инерционное · верно')
  expect(html).toContain('Полярность: Отрицательная · неверно')
  expect(html).not.toContain('Приватные тезисы')
  expect(html).toContain('Модели остальных игроков')
  expect(html).toContain('Финальная модель не отправлена')
  expect(html).toContain('Фильтр итогового аудита по игроку')
  expect(html).toContain('value="player-a" selected=""')
  expect(html).toContain('Моя финальная модель')
  expect(html).toContain('Итоговый рейтинг')
  expect(html).toContain('Вы победили')
  expect(html).toContain('1 место · 21 очко')
  expect(html).not.toContain('Альфа · Слот 1')
  expect(html).not.toContain('Исследование завершено')
  expect(html).not.toContain('Рейтинг: 21')
  expect(html).not.toContain('Rating')
  expect(html).toMatch(/<details[^>]*data-audit-section="ranking"/)
  expect(html).not.toMatch(/<details[^>]*data-audit-section="ranking"[^>]*open/)
  expect(html).toContain('Место и вклад каждого участника')
  expect(html).toContain('Как определён результат')
  expect(html).toContain('Рейтинг → верные тезисы → оставшийся Бюджет')
  expect(html).toContain('При полном равенстве победа общая')
  expect(html).toContain('Выбывшие не могут победить, идут после активных')
  expect(html).toContain('среди них выше тот, кто вышел позже')
  expect(html).toContain('Корпоративное доверие показывает число выполненных обычных контрактов')
  expect(html).toContain('Факторы итогового места игрока Альфа')
  expect(html).toContain('Оставшийся Бюджет')
  expect(html).toContain('Корпоративное доверие')
  expect(html).toContain('>Вы<')
  expect(html).toMatch(/<details[^>]*aria-label="Из чего сложились очки игрока Альфа"/)
  expect(html).not.toMatch(/<details[^>]*aria-label="Из чего сложились очки игрока Альфа"[^>]*open/)
  expect(html).toContain('Полный аудит по раундам')
  expect(html).toContain('Результаты')
  expect(html).toContain('Разбор игры')
  expect(html).toContain('1/12 верно')
  expect(html).toContain('Aster · 1/2')
  expect(html).toContain('✓ Инерционное · Верно')
  expect(html).toContain('× Отрицательная · Неверно')
  expect(html).toContain('1 раунд ›')
  expect(html).not.toMatch(/<details[^>]*data-audit-section[^>]*open/)
  expect(html).toContain('Раунд 1')
  expect(html).toContain('Распределение Мощности')
  expect(html).toContain('Широкое исследование')
  expect(html).toContain('Исследование игрока Альфа')
  expect(html).toContain('Сложный контракт')
  expect(html).toContain('Цель: Aster · источник')
  expect(html).toContain('Условия: Отражение + Ослабление')
  expect(html).toContain('Доказательство: Aster → Boreal · Импульс · Отражение')
  expect(html).not.toContain('r1-t1')
  expect(html).not.toContain('contract-1')
  expect(html).not.toContain('Резерв')
  expect(html).not.toMatch(/<details[^>]*data-audit-round[^>]*open/)
  expect(html).not.toMatch(/<section[^>]*class="[^"]*panel[^"]*"[^>]*>[\s\S]*Версия правил: 2\s*<\/section>$/)
})

test('separates another winner from the current player result', () => {
  const losingView = {
    ...view,
    audit: {
      ...view.audit,
      placementByPlayer: { 'player-a': 2, 'player-b': 1 },
    },
    winnerPlayerIds: ['player-b'],
  } satisfies TenderView

  const html = renderToStaticMarkup(
    <I18nProvider>
      <CompletedTenderPanel currentUserId="player-a" view={{ ...losingView, audit: losingView.audit }} />
    </I18nProvider>,
  )

  expect(html).toContain('Победитель')
  expect(html).toContain('Бета')
  expect(html).toContain('Ваш результат')
  expect(html).toContain('2 место · 21 очко')
  expect(html).not.toContain('Вы победили')
})

test('keeps four-player ties and long names readable in the server ranking order', () => {
  const players = [
    ...view.players,
    { accessSlot: 3, budget: 2, corporateTrust: 1, contractPowerRestriction: 0, displayName: 'Очень длинное имя исследовательской корпорации', playerId: 'player-c', rating: 12 },
    { accessSlot: 4, budget: 1, corporateTrust: 1, contractPowerRestriction: 0, displayName: 'Гамма', playerId: 'player-d', rating: 12 },
  ]
  const tiedView = {
    ...view,
    audit: {
      ...view.audit,
      finalScientificModelsByPlayer: {
        ...view.audit.finalScientificModelsByPlayer,
        'player-c': { signals: {}, submitted: false },
        'player-d': { signals: {}, submitted: false },
      },
      placementByPlayer: { 'player-a': 1, 'player-b': 4, 'player-c': 2, 'player-d': 2 },
      ratingBreakdownByPlayer: {
        ...view.audit.ratingBreakdownByPlayer,
        'player-c': { completeModelBonus: 0, contractPoints: 4, correctPropertyPoints: 4, correctSignalPoints: 2, otherPoints: 0, thesisPoints: 2, total: 12 },
        'player-d': { completeModelBonus: 0, contractPoints: 4, correctPropertyPoints: 4, correctSignalPoints: 2, otherPoints: 0, thesisPoints: 2, total: 12 },
      },
    },
    players,
  } satisfies TenderView

  const html = renderToStaticMarkup(
    <I18nProvider>
      <CompletedTenderPanel
        currentUserId="player-c"
        view={{ ...tiedView, audit: tiedView.audit }}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Очень длинное имя исследовательской корпорации')
  expect(html.match(/>02</g)).toHaveLength(2)
  expect(html).toContain('data-current-player="true"')
  expect(html).toContain('4 участника ›')
  expect(html).toContain('3 игрока ›')

  const threePlayerHtml = renderToStaticMarkup(
    <I18nProvider>
      <CompletedTenderPanel
        currentUserId="player-c"
        view={{ ...tiedView, audit: tiedView.audit, players: tiedView.players.slice(0, 3) }}
      />
    </I18nProvider>,
  )
  expect(threePlayerHtml).toContain('Очень длинное имя исследовательской корпорации')
  expect(threePlayerHtml).not.toContain('Гамма')
})
