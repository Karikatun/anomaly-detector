import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AnalyticsScreen } from '../src/analytics-screen'

test('renders aggregate-only funnel, sources, bots and bounded windows', () => {
  const html = renderToStaticMarkup(
    <AnalyticsScreen
      data={{
        botLandingViews: 2,
        campaigns: [],
        mode: 'consented',
        daily: [{ count: 10, date: '2026-08-23', event: 'landing_view' }],
        generatedAt: '2026-08-23T12:00:00.000Z',
        sources: [{ category: 'direct', landingViews: 10 }],
        steps: [
          { count: 10, event: 'landing_view' },
          { count: 5, event: 'tutorial_cta' },
        ],
        transitions: [{
          conversionRate: 0.5,
          count: 5,
          from: 'landing_view',
          to: 'tutorial_cta',
        }],
        windowDays: 30,
      }}
      isRefreshing={false}
      onBack={() => undefined}
      onLogout={() => undefined}
      onRefresh={() => undefined}
      onWindowChange={() => undefined}
    />,
  )

  expect(html).toContain('Путь публичного MVP')
  expect(html).toContain('30 дней')
  expect(html).toContain('Landing')
  expect(html).toContain('Перешли к обучению')
  expect(html).toContain('Известные боты')
  expect(html).toContain('Прямой переход')
  expect(html).toContain('aria-label="Динамика воронки по дням"')
  expect(html).toContain('tabindex="0"')
  expect(html).not.toMatch(/UUID|логин|сырые события|visitor|journey/i)
})

test('compares six anonymous advertisement counters without presenting them as unique players', () => {
  const html = renderToStaticMarkup(<AnalyticsScreen
    data={{
      botLandingViews: 0,
      campaigns: [
        { campaign: 'ad_01', landingViews: 20, tutorialClicks: 4 },
        { campaign: 'ad_06', landingViews: 0, tutorialClicks: 0 },
      ],
      daily: [], generatedAt: '2026-09-10T12:00:00.000Z', mode: 'aggregate', sources: [],
      steps: [{ event: 'landing_view', count: 20 }, { event: 'tutorial_cta', count: 4 }],
      transitions: [], windowDays: 7,
    }}
    isRefreshing={false} onBack={() => undefined} onLogout={() => undefined}
    onRefresh={() => undefined} onWindowChange={() => undefined}
  />)
  expect(html).toContain('Лендинг и объявления')
  expect(html).toContain('Пять раундов, чтобы доказать свою теорию')
  expect(html).toContain('Игры для любителей настольных игр')
  expect(html).toMatch(/20\s*%/)
  expect(html).toContain('не число уникальных людей')
  expect(html).not.toContain('Переходы между соседними шагами')
  expect(html).not.toContain('Завершили регистрацию')
})
