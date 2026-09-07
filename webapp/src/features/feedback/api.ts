import {
  feedbackIntakePayloadSchema,
  feedbackIntakeRequestSchema,
  feedbackReceiptSchema,
  type FeedbackIntakeRequest,
  type FeedbackReceipt,
} from '@anomaly-detector/contracts'

import type { AuthenticatedTransport } from '@/platform/api'
import { ApiRequestError } from '@/platform/api/http-client'

export class FeedbackApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  async submit(input: FeedbackIntakeRequest): Promise<FeedbackReceipt> {
    const request = feedbackIntakeRequestSchema.parse(input)
    try {
      return await this.transport.request('/api/feedback', feedbackReceiptSchema, {
        body: request,
        method: 'POST',
      })
    } catch (error) {
      if (!(
        error instanceof ApiRequestError
        && error.status === 400
        && error.code === 'VALIDATION_ERROR'
      )) throw error

      const rollbackCompatibleRequest = feedbackIntakePayloadSchema.parse(
        Object.fromEntries(
          Object.entries(request).filter(([key]) => key !== 'submissionId'),
        ),
      )
      return this.transport.request('/api/feedback', feedbackReceiptSchema, {
        body: rollbackCompatibleRequest,
        method: 'POST',
      })
    }
  }
}
