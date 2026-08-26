import { expect, test } from 'bun:test'

import { FeedbackApi } from '../src/features/feedback/api'
import type { AuthenticatedTransport } from '../src/platform/api'

test('feedback API sends only the bounded report contract and validates the public receipt', async () => {
  const requests: Array<{ body?: unknown; method?: string; path: string }> = []
  const api = new FeedbackApi({
    request: async (path, schema, options) => {
      requests.push({ body: options?.body, method: options?.method, path })
      return schema.parse({
        acceptedAt: '2026-08-23T12:00:00.000Z',
        publicNumber: 'FB-8M4Q2K7P9X',
      })
    },
  } as AuthenticatedTransport)
  const report = {
    category: 'suggestion' as const,
    desiredChange: 'Добавить краткую подсказку перед первым ходом.',
    linkAccount: false,
    problemSolved: 'Новому игроку будет проще понять цель раунда.',
    replyEmail: null,
    technicalContext: {
      browserClass: 'chromium' as const,
      buildSha: 'a'.repeat(40),
      deviceClass: 'desktop' as const,
      errorId: null,
      routeTemplate: '/profile' as const,
    },
  }

  await expect(api.submit(report)).resolves.toMatchObject({ publicNumber: 'FB-8M4Q2K7P9X' })
  expect(requests).toEqual([{
    body: report,
    method: 'POST',
    path: '/api/feedback',
  }])
})
