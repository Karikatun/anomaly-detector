import { expect, test } from 'bun:test'
import { tutorialLessonOptions } from '../src/features/tutorial/lesson-menu'

test('the lesson menu keeps legacy origin/date distinct from actual base and independent additional status', () => {
  const options = tutorialLessonOptions({ schemaVersion: 1, base: { legacyCredit: { origin: 'legacy', completedAt: null }, completion: { origin: 'scenario', scenarioVersion: 'base-simple-v1', completedAt: '2026-11-03T00:00:00.000Z' } }, additional: { completion: null } }, 'ready')
  expect(options[0]).toMatchObject({ id: 'base', label: 'Базовое', status: 'Пройдено', actionLabel: 'Повторить' })
  expect(options[0].details?.join(' ')).toContain('Прежнее обучение: дата неизвестна')
  expect(options[1]).toMatchObject({ id: 'additional', label: 'Дополнительное', status: 'Ещё не пройдено', actionLabel: 'Начать' })
  expect(tutorialLessonOptions(undefined, 'error').every((option) => option.status === 'Статус пока неизвестен' && option.actionLabel === 'Открыть')).toBe(true)
})
