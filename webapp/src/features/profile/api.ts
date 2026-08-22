import {
  accountProtectionResponseSchema,
  profileStatisticsSchema,
  tutorialProgressSchema,
  type ProfileStatistics,
  type AccountProtectionResponse,
  type ConfirmRecoveryEmailRequest,
  type StartRecoveryEmailRequest,
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

  getTutorialProgress(): Promise<TutorialProgress> {
    return this.transport.request('/api/profile/tutorial', tutorialProgressSchema)
  }

  completeTutorial(): Promise<TutorialProgress> {
    return this.transport.request('/api/profile/tutorial/completion', tutorialProgressSchema, {
      method: 'PUT',
    })
  }
}
