import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { OverviewScreen } from '../src/overview-screen'

test('renders operational data without mutation controls', () => {
  const html = renderToStaticMarkup(
    <OverviewScreen
      data={{
        generatedAt: '2026-08-03T12:00:00.000Z',
        totals: { users: 12, activeSessions: 4, rooms: 3, tenders: 2 },
        roomsByStatus: { waiting: 1, active: 2, completed: 3 },
        tendersByPhase: [{ phase: 'laboratory', count: 2 }],
        users: {
          page: 2,
          pageSize: 20,
          totalItems: 41,
          totalPages: 3,
          items: [{
            id: '019f8099-7e26-7760-ad08-66d1d66b2718',
            login: 'researcher',
            displayName: 'Исследователь',
            createdAt: '2026-08-03T11:00:00.000Z',
          }],
        },
      }}
      isRefreshing={false}
      onLogout={() => undefined}
      onOpenFeedback={() => undefined}
      onOpenMailPolicy={() => undefined}
      onPageChange={() => undefined}
      onRefresh={() => undefined}
    />,
  )

  expect(html).toContain('Системный обзор')
  expect(html).toContain('Все пользователи')
  expect(html).toContain('Политика почты')
  expect(html).toContain('Обратная связь')
  expect(html).toContain('Ожидают игроков')
  expect(html).toContain('Идут сейчас')
  expect(html).toContain('Завершены')
  expect(html).not.toContain('Запускаются')
  expect(html).toContain('researcher')
  expect(html).toContain('Страница 2 из 3')
  expect(html).toContain('Назад')
  expect(html).toContain('Далее')
  expect(html).not.toContain('Создать')
  expect(html).not.toContain('Редактировать')
  expect(html).not.toContain('Удалить')
})
