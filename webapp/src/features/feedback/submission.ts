import {
  feedbackIntakeRequestSchema,
  type FeedbackIntakePayload,
} from '@anomaly-detector/contracts'

import { ApiRequestError } from '@/platform/api/http-client'

export type PendingFeedbackSubmission = {
  comparisonKey: string
  request: ReturnType<typeof feedbackIntakeRequestSchema.parse>
}

export function prepareFeedbackSubmission(
  payload: FeedbackIntakePayload,
  pending: PendingFeedbackSubmission | null,
  createSubmissionId: () => string = randomUUID,
) {
  const comparisonKey = JSON.stringify(Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'technicalContext'),
  ))
  if (pending?.comparisonKey === comparisonKey) {
    return { pending, request: pending.request }
  }

  const request = feedbackIntakeRequestSchema.parse({
    ...payload,
    submissionId: createSubmissionId(),
  })
  const nextPending = { comparisonKey, request }
  return {
    pending: nextPending,
    request,
  }
}

export function pendingFeedbackSubmissionAfterError(
  pending: PendingFeedbackSubmission,
  error: unknown,
) {
  return error instanceof ApiRequestError && error.status === 409 ? null : pending
}

function randomUUID() {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure random UUID generation is unavailable')
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
