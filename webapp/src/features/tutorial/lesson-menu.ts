import type { TutorialLessonId, TutorialLessonsProgress } from '@anomaly-detector/contracts'
import { translate } from '@/platform/i18n'

export function tutorialLessonOptions(progress: TutorialLessonsProgress | undefined, loadState: 'ready' | 'loading' | 'error') {
  return (['base', 'additional'] as const).map((id: TutorialLessonId) => {
    const completion = progress?.[id].completion
    const legacy = id === 'base' ? progress?.base.legacyCredit : null
    const unknown = !progress && loadState !== 'ready'
    const completed = Boolean(completion || legacy)
    const details: string[] = []
    if (completion) details.push(translate(id === 'base' ? 'tutorial.base.actualDate' : 'tutorial.lessonMenu.additionalDate', { date: new Date(completion.completedAt).toLocaleDateString('ru-RU') }))
    if (legacy) details.push(translate('tutorial.base.legacyDate', { date: legacy.completedAt ? new Date(legacy.completedAt).toLocaleDateString('ru-RU') : translate('tutorial.base.unknownDate') }))
    return {
      id, label: translate(id === 'base' ? 'tutorial.lessonMenu.base' : 'tutorial.lessonMenu.additional'),
      description: translate(id === 'base' ? 'tutorial.lessonMenu.baseDescription' : 'tutorial.lessonMenu.additionalDescription'),
      status: translate(unknown ? 'tutorial.lessonMenu.unknown' : completion ? 'tutorial.lessonMenu.completed' : legacy ? 'tutorial.lessonMenu.legacy' : 'tutorial.lessonMenu.notCompleted'),
      actionLabel: translate(unknown ? 'tutorial.lessonMenu.open' : completed ? 'tutorial.lessonMenu.repeat' : 'tutorial.lessonMenu.start'),
      details,
    }
  })
}
