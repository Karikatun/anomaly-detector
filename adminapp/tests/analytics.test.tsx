import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AnalyticsScreen } from '../src/analytics-screen'

test('renders aggregate-only funnel, sources, bots and bounded windows', () => {
  const html = renderToStaticMarkup(
    <AnalyticsScreen
      data={{
        botLandingViews: 2,
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
