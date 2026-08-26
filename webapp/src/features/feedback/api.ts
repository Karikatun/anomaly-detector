import {
  feedbackIntakeRequestSchema,
  feedbackReceiptSchema,
  type FeedbackIntakeRequest,
  type FeedbackReceipt,
} from '@anomaly-detector/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export class FeedbackApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  submit(input: FeedbackIntakeRequest): Promise<FeedbackReceipt> {
    return this.transport.request('/api/feedback', feedbackReceiptSchema, {
      body: feedbackIntakeRequestSchema.parse(input),
      method: 'POST',
    })
  }
}
