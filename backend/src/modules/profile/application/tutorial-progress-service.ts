import type { TutorialProgress } from '@anomaly-detector/contracts'

import type { TutorialProgressRepository } from './ports'

export class TutorialProgressService {
  constructor(private readonly repository: TutorialProgressRepository) {}

  async read(userId: string): Promise<TutorialProgress> {
    return serialize(await this.repository.read(userId))
  }

  async complete(userId: string): Promise<TutorialProgress> {
    return serialize(await this.repository.complete(userId, new Date()))
  }
}

function serialize(completedAt: Date | null): TutorialProgress {
  return { completedAt: completedAt?.toISOString() ?? null }
}
