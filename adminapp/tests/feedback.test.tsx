import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeedbackScreen } from '../src/feedback-screen'

test('renders immutable feedback source and only the approved operator commands', () => {
  const html = renderToStaticMarkup(
    <FeedbackScreen
      data={{
        items: [{
          canContinue: false,
          category: 'error',
          contactDeletedAt: null,
          createdAt: '2026-08-23T12:00:00.000Z',
          expectedResult: 'Карточка должна открыться.',
          githubIssueNumber: null,
          id: '019f8099-7e26-7760-ad08-66d1d66b2718',
          linkedAccountId: '019f8099-7e26-7760-ad08-66d1d66b2719',
          publicNumber: 'FB-8M4Q2K7P9X',
          rejectedAt: null,
          rejectionReason: null,
          replyEmail: 'reply@example.com',
          reproductionSteps: 'Открыл матч и нажал на карточку.',
          resolvedAt: null,
          status: 'new',
          takenAt: null,
          technicalContext: {
            browserClass: 'chromium',
            buildSha: 'a'.repeat(40),
            deviceClass: 'desktop',
            errorId: null,
            routeTemplate: '/tenders/$tenderId',
          },
          transferredAt: null,
          updatedAt: '2026-08-23T12:00:00.000Z',
          version: 1,
          whatHappened: 'Карточка не открылась.',
        }],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      }}
      onBack={() => undefined}
      onDeleteContact={async () => undefined}
      onLogout={() => undefined}
      onPageChange={() => undefined}
      onRecordGithubIssue={async () => undefined}
      onReject={async () => undefined}
      onReload={async () => undefined}
      onResolve={async () => undefined}
      onTake={async () => undefined}
    />,
  )

  expect(html).toContain('Очередь обратной связи')
  expect(html).toContain('FB-8M4Q2K7P9X')
  expect(html).toContain('Карточка не открылась.')
  expect(html).toContain('reply@example.com')
  expect(html).toContain('Взять в работу')
  expect(html).toContain('Отклонить с причиной')
  expect(html).toContain('Удалить контакт')
  expect(html).not.toContain('Изменить текст')
  expect(html).not.toMatch(/keyHash|ipAddress|cookie|token/i)
})
