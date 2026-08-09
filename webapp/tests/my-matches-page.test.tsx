import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { RoomView } from '@anomaly-detector/contracts'

import { MatchHistoryFeedback, MatchHistoryList } from '../src/features/rooms/pages/MyMatchesPage'
import { formatUuidV7Date } from '../src/features/rooms/pages/match-history'
import { I18nProvider } from '../src/platform/i18n'

const completedMatch = {
  capacity: 4,
  hostId: '019f8099-7e26-7760-ad08-66d1d66b2717',
  joinCode: null,
  members: [
    { displayName: 'Альфа', ready: true, seat: 1, userId: '019f8099-7e26-7760-ad08-66d1d66b2718' },
    { displayName: 'Исследовательская корпорация Северного контура с очень длинным именем', ready: true, seat: 2, userId: '019f8099-7e26-7760-ad08-66d1d66b2719' },
    { displayName: 'Гамма', ready: true, seat: 3, userId: '019f8099-7e26-7760-ad08-66d1d66b2720' },
    { displayName: 'Дельта', ready: true, seat: 4, userId: '019f8099-7e26-7760-ad08-66d1d66b2721' },
  ],
  roomId: '019f8099-7e26-7760-ad08-66d1d66b2722',
  serverTime: '2026-08-09T12:00:00.000Z',
  status: 'started',
  tenderId: '019f8099-7e26-7760-ad08-66d1d66b2723',
  tenderPhase: 'complete',
  tenderPlacement: 2,
  tenderRuleset: 'tender-v2',
} satisfies RoomView

test('renders a scan-friendly four-player history row with the current placement', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <MatchHistoryList
        currentUserId="019f8099-7e26-7760-ad08-66d1d66b2719"
        matches={[completedMatch]}
        onOpen={() => undefined}
      />
    </I18nProvider>,
  )

  expect(html).toContain('role="table"')
  expect(html).toContain('Игроки')
  expect(html).toContain('Место')
  expect(html).toContain('2 место')
  expect(html).toContain('Участников: 4')
  expect(html).toContain('Исследовательская корпорация Северного контура с очень длинным именем')
  expect(html).toContain('>Вы<')
  expect(html).toContain('Детали')
})

test('keeps an unfinished forfeited match explicit without inventing a placement', () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <MatchHistoryList
        currentUserId={completedMatch.members[0].userId}
        matches={[{
          ...completedMatch,
          tenderForfeited: true,
          tenderPhase: 'laboratory',
          tenderPlacement: undefined,
        }]}
        onOpen={() => undefined}
      />
    </I18nProvider>,
  )

  expect(html).toContain('Вы выбыли')
  expect(html).toContain('После завершения')
  expect(html).toContain('Недоступно после выхода')
  expect(html).not.toContain('2 место')
})

test('formats UUIDv7 match timestamps as a long Russian date with time', () => {
  const value = formatUuidV7Date(completedMatch.tenderId)
  expect(value.date).not.toBe('—')
  expect(value.date).toMatch(/[а-яё]+/i)
  expect(value.time).toMatch(/^\d{2}:\d{2}$/)
  expect(formatUuidV7Date('not-a-tender')).toEqual({ date: '—', time: '' })
})

test.each([
  ['loading', 'Загружаем историю...'],
  ['error', 'Не удалось загрузить историю матчей'],
  ['empty', 'История пока пуста'],
] as const)('renders the %s history state', (state, copy) => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <MatchHistoryFeedback state={state} onAction={() => undefined} />
    </I18nProvider>,
  )

  expect(html).toContain(copy)
})
