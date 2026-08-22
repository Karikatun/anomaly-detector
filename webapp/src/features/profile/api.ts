import {
  accountProtectionResponseSchema,
  recoveryCodeSetResponseSchema,
  startRecoveryCodeReissueResponseSchema,
  profileStatisticsSchema,
  recoveryEmailReplacementCommandResponseSchema,
  tutorialProgressSchema,
  type ProfileStatistics,
  type AccountProtectionResponse,
  type ConfirmRecoveryCodeReissueRequest,
  type ConfirmRecoveryEmailReplacementRequest,
  type ConfirmRecoveryEmailRequest,
  type RecoveryEmailReplacementCommandResponse,
  type RecoveryCodeSetResponse,
  type ResendRecoveryEmailReplacementRequest,
  type StartRecoveryEmailReplacementRequest,
  type StartRecoveryEmailRequest,
  type StartRecoveryCodeReissueRequest,
  type StartRecoveryCodeReissueResponse,
  type TutorialProgress,
} from '@anomaly-detector/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export class ProfileApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  getStatistics(): Promise<ProfileStatistics> {
    return this.transport.request('/api/profile/statistics', profileStatisticsSchema)
  }

  getAccountProtection(): Promise<AccountProtectionResponse> {
    return this.transport.request(
      '/api/auth/account-protection',
      accountProtectionResponseSchema,
    )
  }

  startRecoveryEmail(input: StartRecoveryEmailRequest): Promise<AccountProtectionResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/start',
      accountProtectionResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  resendRecoveryEmail(): Promise<AccountProtectionResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/resend',
      accountProtectionResponseSchema,
      { body: {}, method: 'POST' },
    )
  }

  confirmRecoveryEmail(input: ConfirmRecoveryEmailRequest): Promise<AccountProtectionResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/confirm',
      accountProtectionResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  cancelRecoveryEmail(): Promise<AccountProtectionResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/cancel',
      accountProtectionResponseSchema,
      { body: {}, method: 'POST' },
    )
  }

  startRecoveryEmailReplacement(
    input: StartRecoveryEmailReplacementRequest,
  ): Promise<RecoveryEmailReplacementCommandResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/replacement/start',
      recoveryEmailReplacementCommandResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  resendRecoveryEmailReplacement(
    input: ResendRecoveryEmailReplacementRequest,
  ): Promise<RecoveryEmailReplacementCommandResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/replacement/resend',
      recoveryEmailReplacementCommandResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  confirmRecoveryEmailReplacement(
    input: ConfirmRecoveryEmailReplacementRequest,
  ): Promise<RecoveryEmailReplacementCommandResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/replacement/confirm',
      recoveryEmailReplacementCommandResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  cancelRecoveryEmailReplacement(): Promise<AccountProtectionResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-email/replacement/cancel',
      accountProtectionResponseSchema,
      { body: {}, method: 'POST' },
    )
  }

  issueRecoveryCodes(): Promise<RecoveryCodeSetResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-codes/issue',
      recoveryCodeSetResponseSchema,
      { body: {}, method: 'POST' },
    )
  }

  startRecoveryCodeReissue(
    input: StartRecoveryCodeReissueRequest,
  ): Promise<StartRecoveryCodeReissueResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-codes/reissue/start',
      startRecoveryCodeReissueResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  confirmRecoveryCodeReissue(
    input: ConfirmRecoveryCodeReissueRequest,
  ): Promise<RecoveryCodeSetResponse> {
    return this.transport.request(
      '/api/auth/account-protection/recovery-codes/reissue/confirm',
      recoveryCodeSetResponseSchema,
      { body: input, method: 'POST' },
    )
  }

  getTutorialProgress(): Promise<TutorialProgress> {
    return this.transport.request('/api/profile/tutorial', tutorialProgressSchema)
  }

  completeTutorial(): Promise<TutorialProgress> {
    return this.transport.request('/api/profile/tutorial/completion', tutorialProgressSchema, {
      method: 'PUT',
    })
  }
}
