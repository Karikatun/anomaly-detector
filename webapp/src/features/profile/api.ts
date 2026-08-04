import {
  profileStatisticsSchema,
  tutorialProgressSchema,
  type ProfileStatistics,
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

  getTutorialProgress(): Promise<TutorialProgress> {
    return this.transport.request('/api/profile/tutorial', tutorialProgressSchema)
  }

  completeTutorial(): Promise<TutorialProgress> {
    return this.transport.request('/api/profile/tutorial/completion', tutorialProgressSchema, {
      method: 'PUT',
    })
  }
}
