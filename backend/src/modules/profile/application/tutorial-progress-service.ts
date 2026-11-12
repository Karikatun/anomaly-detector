import type { TutorialLessonsProgress, TutorialProgress, TutorialProgressCommand } from '@anomaly-detector/contracts'

import type { TutorialProgressRepository } from './ports'

export class TutorialProgressService {
  constructor(
    private readonly repository: TutorialProgressRepository,
    private readonly formatWritesEnabled: boolean,
  ) {}

  async read(userId: string): Promise<TutorialProgress> {
    return serialize(await this.repository.read(userId))
  }

  async complete(userId: string): Promise<TutorialProgress> {
    const completedAt = await this.repository.complete(userId, new Date())
    if (!completedAt) throw new TutorialProgressFailure('account_unavailable')
    return serialize(completedAt)
  }

  async readLessons(userId: string): Promise<TutorialLessonsProgress> {
    const progress = await this.repository.readLessons(userId)
    if (!progress) throw new TutorialProgressFailure('account_unavailable')
    return progress
  }

  async recordLesson(userId: string, command: TutorialProgressCommand): Promise<TutorialLessonsProgress> {
    if (!this.formatWritesEnabled) throw new TutorialProgressFailure('lesson_writes_disabled')
    const progress = await this.repository.recordLesson(userId, command, new Date())
    if (!progress) throw new TutorialProgressFailure('account_unavailable')
    return progress
  }
}

export class TutorialProgressFailure extends Error {
  constructor(public readonly kind: 'account_unavailable' | 'lesson_writes_disabled') {
    super(kind === 'lesson_writes_disabled'
      ? 'Сохранение прогресса уроков временно недоступно.'
      : 'Session is invalid or expired')
  }
}

function serialize(completedAt: Date | null): TutorialProgress {
  return { completedAt: completedAt?.toISOString() ?? null }
}
