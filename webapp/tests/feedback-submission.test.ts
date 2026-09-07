import { expect, test } from 'bun:test'

import { feedbackIntakePayloadSchema } from '@anomaly-detector/contracts'

import { ApiRequestError } from '../src/platform/api/http-client'
import {
  pendingFeedbackSubmissionAfterError,
  prepareFeedbackSubmission,
} from '../src/features/feedback/submission'

const firstSubmissionId = '019f8099-7e26-7760-ad08-66d1d66b2730'
const secondSubmissionId = '019f8099-7e26-7760-ad08-66d1d66b2731'

test('reuses one client-generated UUID while retrying the same normalized payload before navigation', () => {
  const createSubmissionId = submissionIdSequence()
  const firstPayload = feedbackIntakePayloadSchema.parse(suggestionPayload({
    desiredChange: '  Добавить краткую подсказку перед первым ходом.  ',
  }))
  const normalizedRetry = feedbackIntakePayloadSchema.parse(suggestionPayload())

  const first = prepareFeedbackSubmission(firstPayload, null, createSubmissionId)
  const retry = prepareFeedbackSubmission(normalizedRetry, first.pending, createSubmissionId)

  expect(first.request.submissionId).toBe(firstSubmissionId)
  expect(retry.request.submissionId).toBe(firstSubmissionId)
  expect(retry.pending).toEqual(first.pending)
})

test('reuses the exact original request when only automatic technical context changes', () => {
  const createSubmissionId = submissionIdSequence()
  const firstPayload = feedbackIntakePayloadSchema.parse(suggestionPayload())
  const resizedPayload = feedbackIntakePayloadSchema.parse(suggestionPayload({
    technicalContext: {
      ...firstPayload.technicalContext,
      deviceClass: 'mobile',
    },
  }))

  const first = prepareFeedbackSubmission(firstPayload, null, createSubmissionId)
  const retry = prepareFeedbackSubmission(resizedPayload, first.pending, createSubmissionId)

  expect(retry.request).toEqual(first.request)
  expect(retry.request.technicalContext.deviceClass).toBe('desktop')
})

test('creates a fresh UUID after the normalized payload changes', () => {
  const createSubmissionId = submissionIdSequence()
  const first = prepareFeedbackSubmission(
    feedbackIntakePayloadSchema.parse(suggestionPayload()),
    null,
    createSubmissionId,
  )
  const changed = prepareFeedbackSubmission(
    feedbackIntakePayloadSchema.parse(suggestionPayload({
      problemSolved: 'Опытному игроку будет проще объяснить правила новичку.',
    })),
    first.pending,
    createSubmissionId,
  )

  expect(first.request.submissionId).toBe(firstSubmissionId)
  expect(changed.request.submissionId).toBe(secondSubmissionId)
  expect(changed.pending).not.toEqual(first.pending)
})

test('rotates the UUID after a server conflict but retains it after an unknown outcome', () => {
  const payload = feedbackIntakePayloadSchema.parse(suggestionPayload())
  const createSubmissionId = submissionIdSequence()
  const first = prepareFeedbackSubmission(payload, null, createSubmissionId)

  const unknownOutcome = pendingFeedbackSubmissionAfterError(first.pending, new TypeError('network lost'))
  expect(prepareFeedbackSubmission(payload, unknownOutcome, createSubmissionId).request.submissionId)
    .toBe(firstSubmissionId)

  const conflict = new ApiRequestError(409, 'CONFLICT', 'conflict')
  const cleared = pendingFeedbackSubmissionAfterError(first.pending, conflict)
  expect(prepareFeedbackSubmission(payload, cleared, createSubmissionId).request.submissionId)
    .toBe(secondSubmissionId)
})

test('validates the injected secure UUID generator output', () => {
  const payload = feedbackIntakePayloadSchema.parse(suggestionPayload())

  expect(() => prepareFeedbackSubmission(payload, null, () => 'not-a-uuid')).toThrow()
})

function suggestionPayload(overrides: Record<string, unknown> = {}) {
  return {
    category: 'suggestion',
    desiredChange: 'Добавить краткую подсказку перед первым ходом.',
    linkAccount: false,
    problemSolved: 'Новому игроку будет проще понять цель раунда.',
    replyEmail: null,
    technicalContext: {
      browserClass: 'chromium',
      buildSha: 'a'.repeat(40),
      deviceClass: 'desktop',
      errorId: null,
      routeTemplate: '/profile',
    },
    ...overrides,
  }
}

function submissionIdSequence() {
  const ids = [firstSubmissionId, secondSubmissionId]
  let index = 0
  return () => ids[index++] ?? crypto.randomUUID()
}
