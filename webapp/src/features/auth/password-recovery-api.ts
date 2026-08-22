import {
  completePasswordResetRequestSchema,
  passwordResetCompletionResponseSchema,
  requestPasswordResetRequestSchema,
  requestPasswordResetResponseSchema,
  type CompletePasswordResetRequest,
  type PasswordResetCompletionResponse,
  type RequestPasswordResetRequest,
  type RequestPasswordResetResponse,
} from '@anomaly-detector/contracts'

import { HttpClient } from '@/platform/api'

export class PasswordRecoveryApi {
  private readonly http: Pick<HttpClient, 'request'>

  constructor(http: Pick<HttpClient, 'request'> = new HttpClient()) {
    this.http = http
  }

  requestReset(input: RequestPasswordResetRequest): Promise<RequestPasswordResetResponse> {
    return this.http.request(
      '/api/auth/password-recovery/request',
      requestPasswordResetResponseSchema,
      {
        method: 'POST',
        body: requestPasswordResetRequestSchema.parse(input),
      },
    )
  }

  completeReset(
    input: CompletePasswordResetRequest,
  ): Promise<PasswordResetCompletionResponse> {
    return this.http.request(
      '/api/auth/password-recovery/complete',
      passwordResetCompletionResponseSchema,
      {
        method: 'POST',
        body: completePasswordResetRequestSchema.parse(input),
      },
    )
  }
}
