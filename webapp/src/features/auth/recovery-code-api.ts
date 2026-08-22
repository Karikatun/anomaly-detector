import {
  recoveryCodeEmailReplacementConfirmRequestSchema,
  recoveryCodeEmailReplacementConfirmResponseSchema,
  recoveryCodeEmailReplacementStartRequestSchema,
  recoveryCodeEmailReplacementStartResponseSchema,
  recoveryCodePasswordRequestSchema,
  recoveryCodeUseResponseSchema,
  type RecoveryCodeEmailReplacementConfirmRequest,
  type RecoveryCodeEmailReplacementConfirmResponse,
  type RecoveryCodeEmailReplacementStartRequest,
  type RecoveryCodeEmailReplacementStartResponse,
  type RecoveryCodePasswordRequest,
  type RecoveryCodeUseResponse,
} from '@anomaly-detector/contracts'

import { HttpClient } from '@/platform/api'

export class RecoveryCodeApi {
  private readonly http: Pick<HttpClient, 'request'>

  constructor(http: Pick<HttpClient, 'request'> = new HttpClient()) {
    this.http = http
  }

  recoverPassword(input: RecoveryCodePasswordRequest): Promise<RecoveryCodeUseResponse> {
    return this.http.request('/api/auth/recovery-code/password', recoveryCodeUseResponseSchema, {
      method: 'POST',
      body: recoveryCodePasswordRequestSchema.parse(input),
    })
  }

  startRecoveryEmailReplacement(
    input: RecoveryCodeEmailReplacementStartRequest,
  ): Promise<RecoveryCodeEmailReplacementStartResponse> {
    return this.http.request(
      '/api/auth/recovery-code/recovery-email/start',
      recoveryCodeEmailReplacementStartResponseSchema,
      {
        method: 'POST',
        body: recoveryCodeEmailReplacementStartRequestSchema.parse(input),
      },
    )
  }

  confirmRecoveryEmailReplacement(
    input: RecoveryCodeEmailReplacementConfirmRequest,
  ): Promise<RecoveryCodeEmailReplacementConfirmResponse> {
    return this.http.request(
      '/api/auth/recovery-code/recovery-email/confirm',
      recoveryCodeEmailReplacementConfirmResponseSchema,
      {
        method: 'POST',
        body: recoveryCodeEmailReplacementConfirmRequestSchema.parse(input),
      },
    )
  }
}
