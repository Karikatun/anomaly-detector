import type { TutorialProgress } from '@anomaly-detector/contracts'

import type { TutorialProgressRepository } from './ports'

export class TutorialProgressService {
  constructor(private readonly repository: TutorialProgressRepository) {}

  async read(userId: string): Promise<TutorialProgress> {
    return serialize(await this.repository.read(userId))
  }

  async complete(userId: string): Promise<TutorialProgress> {
    const completedAt = await this.repository.complete(userId, new Date())
    if (!completedAt) throw new TutorialProgressFailure('account_unavailable')
    return serialize(completedAt)
  }
}

export class TutorialProgressFailure extends Error {
  constructor(public readonly kind: 'account_unavailable') {
    super('Session is invalid or expired')
  }
}

function serialize(completedAt: Date | null): TutorialProgress {
  return { completedAt: completedAt?.toISOString() ?? null }
}
