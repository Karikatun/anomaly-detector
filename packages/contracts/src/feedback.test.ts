import { describe, expect, test } from 'bun:test'

import {
  feedbackIntakeRequestSchema,
  feedbackOperatorCommandResponseSchema,
  feedbackQueueResponseSchema,
  feedbackReceiptSchema,
  feedbackRecordGithubIssueCommandSchema,
  feedbackRejectCommandSchema,
} from './feedback'

const technicalContext = {
  browserClass: 'chromium',
  buildSha: 'a'.repeat(40),
  deviceClass: 'desktop',
  errorId: 'err_01J5ZXVY7P',
  routeTemplate: '/tenders/$tenderId',
} as const

describe('feedback player contracts', () => {
  test('accepts only bounded product-owned report fields', () => {
    const report = feedbackIntakeRequestSchema.parse({
      category: 'error',
      canContinue: false,
      expectedResult: 'Карточка должна открыться.',
      linkAccount: true,
      replyEmail: 'player@example.com',
      reproductionSteps: 'Открыл матч и нажал на карточку.',
      technicalContext,
      whatHappened: 'Карточка не открылась.',
    })

    expect(report.category).toBe('error')
    expect(report.technicalContext.routeTemplate).toBe('/tenders/$tenderId')
    expect(feedbackIntakeRequestSchema.parse({
      category: 'suggestion',
      desiredChange: 'Добавить краткую подсказку перед первым ходом.',
      linkAccount: false,
      problemSolved: 'Новому игроку будет проще понять цель раунда.',
      replyEmail: null,
      technicalContext,
    }).category).toBe('suggestion')
  })

  test('rejects identifiers, secrets, raw URLs, logs, attachments and oversized text', () => {
    const valid = {
      category: 'error' as const,
      canContinue: true,
      expectedResult: 'Ожидал продолжение.',
      linkAccount: false,
      replyEmail: null,
      reproductionSteps: 'Нажал кнопку.',
      technicalContext,
      whatHappened: 'Ничего не произошло.',
    }

    for (const forbidden of [
      { attachment: 'data:image/png;base64,secret' },
      { cookies: 'session=secret' },
      { fullUrl: 'https://game.example/tenders/private-id?token=secret' },
      { ipAddress: '203.0.113.10' },
      { rawLogs: ['Bearer secret'] },
      { tenderState: { privateCards: ['secret'] } },
    ]) {
      expect(feedbackIntakeRequestSchema.safeParse({ ...valid, ...forbidden }).success).toBe(false)
    }

    expect(feedbackIntakeRequestSchema.safeParse({
      ...valid,
      technicalContext: { ...technicalContext, routeTemplate: '/tenders/private-id' },
    }).success).toBe(false)
    expect(feedbackIntakeRequestSchema.safeParse({
      ...valid,
      whatHappened: 'x'.repeat(2_001),
    }).success).toBe(false)
  })

  test('returns only a copyable public receipt', () => {
    expect(feedbackReceiptSchema.parse({
      acceptedAt: '2026-08-23T12:00:00.000Z',
      publicNumber: 'FB-8M4Q2K7P9X',
    })).toEqual({
      acceptedAt: '2026-08-23T12:00:00.000Z',
      publicNumber: 'FB-8M4Q2K7P9X',
    })
    expect(feedbackReceiptSchema.safeParse({
      acceptedAt: '2026-08-23T12:00:00.000Z',
      id: '019f8099-7e26-7760-ad08-66d1d66b2718',
      publicNumber: 'FB-8M4Q2K7P9X',
    }).success).toBe(false)
  })
})

describe('feedback operator contracts', () => {
  test('exposes a bounded protected queue without budget identities', () => {
    const response = feedbackQueueResponseSchema.parse({
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      items: [{
        category: 'suggestion',
        contactDeletedAt: null,
        createdAt: '2026-08-23T12:00:00.000Z',
        desiredChange: 'Добавить краткую подсказку.',
        githubIssueNumber: null,
        id: '019f8099-7e26-7760-ad08-66d1d66b2718',
        linkedAccountId: null,
        problemSolved: 'Новому игроку будет проще начать.',
        publicNumber: 'FB-8M4Q2K7P9X',
        rejectedAt: null,
        rejectionReason: null,
        replyEmail: null,
        resolvedAt: null,
        status: 'new',
        takenAt: null,
        technicalContext,
        transferredAt: null,
        updatedAt: '2026-08-23T12:00:00.000Z',
        version: 1,
      }],
    })

    expect(response.items).toHaveLength(1)
    expect(JSON.stringify(response)).not.toMatch(/ipAddress|keyHash|password|token|cookie/i)
  })

  test('bounds explicit optimistic commands and sanitized GitHub issue numbers', () => {
    const base = {
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      expectedVersion: 1,
    }
    expect(feedbackRejectCommandSchema.parse({
      ...base,
      reason: 'Недостаточно сведений для воспроизведения.',
    }).reason).toContain('воспроизведения')
    expect(feedbackRecordGithubIssueCommandSchema.parse({
      ...base,
      githubIssueNumber: 41,
    }).githubIssueNumber).toBe(41)
    expect(feedbackRecordGithubIssueCommandSchema.safeParse({
      ...base,
      githubIssueNumber: 'https://github.com/org/repo/issues/41?token=secret',
    }).success).toBe(false)
  })

  test('returns the new version and idempotency receipt without source content', () => {
    const response = feedbackOperatorCommandResponseSchema.parse({
      commandId: '019f8099-7e26-7760-ad08-66d1d66b2720',
      reportId: '019f8099-7e26-7760-ad08-66d1d66b2718',
      version: 2,
    })

    expect(response.version).toBe(2)
    expect(response).not.toHaveProperty('content')
    expect(response).not.toHaveProperty('replyEmail')
  })
})
