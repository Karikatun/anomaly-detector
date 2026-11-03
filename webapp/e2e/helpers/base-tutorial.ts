import { expect, type Page } from '@playwright/test'

export type BaseTutorialCheckpoint = (step?: string) => Promise<void>
const noCheckpoint: BaseTutorialCheckpoint = async () => undefined

export const baseGuestSessionKey = 'anomaly-detector:tutorial:base:base-simple-v1:tutorial-guest'

export async function confirmAllocation(page: Page, choices: Array<[string, number]>, checkpoint: BaseTutorialCheckpoint = noCheckpoint) {
  for (const [category, count] of choices) {
    for (let i = 0; i < count; i++) { await page.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true }).click(); await checkpoint() }
  }
  await page.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
  await checkpoint()
  const reserve = page.getByRole('dialog', { name: 'Часть мощности не распределена', exact: true })
  if (choices.reduce((sum, [, count]) => sum + count, 0) < 4) {
    await expect(reserve).toBeVisible()
    await reserve.getByRole('button', { name: 'Подтвердить и продолжить', exact: true }).click()
    await checkpoint()
  }
}
export async function chooseBaseSlot(page: Page, slot: number, checkpoint: BaseTutorialCheckpoint = noCheckpoint) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  await checkpoint()
}
export async function submitBaseThesis(page: Page, signal: string, fieldType: string, polarity: string, pressDuration = 0, checkpoint: BaseTutorialCheckpoint = noCheckpoint) {
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption(signal)
  await checkpoint()
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption(fieldType)
  await checkpoint()
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption(polarity)
  await checkpoint()
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click({ delay: pressDuration })
  await checkpoint()
}
export async function reachBaseFirstResearch(page: Page, guest: boolean | 'current' = true, checkpoint: BaseTutorialCheckpoint = noCheckpoint) {
  if (guest === true) await page.goto('/learn')
  else if (guest === false) await page.getByRole('button', { name: /ПРОЙТИ ОБУЧЕНИЕ|ПОВТОРИТЬ ОБУЧЕНИЕ/ }).click()
  await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  await checkpoint()
  await chooseBaseSlot(page, 6, checkpoint)
  await checkpoint('round-1-power')
  await confirmAllocation(page, [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]], checkpoint)
  await page.getByRole('button', { name: /^Сигнал для разведки: Aster/ }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  await checkpoint()
}

// The test knows a worked fixture; the UI receives only the learner's observations.
// Nothing in this helper reads local truth or writes progress to skip the exercise.
export async function playBaseTutorial(page: Page, guest: boolean | 'current' = true, wrongCinder = false, checkpoint: BaseTutorialCheckpoint = noCheckpoint, heldThesis?: 'aster' | 'cinder', awaitCompletion = true) {
  await reachBaseFirstResearch(page, guest, checkpoint)
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await page.getByTestId('tutorial-research-trigger').click()
  await checkpoint()
  await journal.getByRole('tab', { name: 'Трактовка', exact: true }).click()
  await checkpoint()
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Инерционное', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Aster: гипотеза, полярность Положительная', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await checkpoint()
  await checkpoint('round-1-thesis')
  await submitBaseThesis(page, 'aster', 'inertial', 'positive', heldThesis === 'aster' ? 250 : 0, checkpoint)
  await checkpoint('round-1-thesis-result')
  await page.getByTestId('floater').getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ', exact: true }).click()
  await checkpoint()
  await checkpoint('round-2-access')
  await chooseBaseSlot(page, 5, checkpoint)
  await confirmAllocation(page, [['Лаборатория', 1], ['Анализ модели', 2]], checkpoint)
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Cinder', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Провести опыт: Boreal → Cinder', exact: true }).click()
  await checkpoint()
  await page.getByTestId('tutorial-research-trigger').click()
  await checkpoint()
  await expect(journal).toContainText('Нестабильный срыв')
  await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: `Cinder: гипотеза, тип поля ${wrongCinder ? 'Инерционное' : 'Фазовое'}`, exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: `Cinder: гипотеза, полярность ${wrongCinder ? 'Положительная' : 'Отрицательная'}`, exact: true }).click()
  await checkpoint()
  await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
  await checkpoint()
  await checkpoint('round-2-thesis')
  if (wrongCinder) {
    await submitBaseThesis(page, 'cinder', 'inertial', 'positive')
    await expect(page.getByTestId('floater')).toContainText('Тип поля неверен.')
    await page.getByTestId('tutorial-research-trigger').click()
    await checkpoint()
    await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await checkpoint()
    await journal.getByRole('button', { name: 'Cinder: гипотеза, тип поля Фазовое', exact: true }).click()
    await checkpoint()
    await journal.getByRole('button', { name: 'Cinder: гипотеза, полярность Отрицательная', exact: true }).click()
    await checkpoint()
    await journal.getByRole('button', { name: 'Закрыть журнал', exact: true }).click()
    await checkpoint()
  }
  await submitBaseThesis(page, 'cinder', 'phase', 'negative', heldThesis === 'cinder' ? 250 : 0, checkpoint)
  await checkpoint('round-2-thesis-result')
  await page.getByTestId('floater').getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ', exact: true }).click()
  await checkpoint()
  await checkpoint('round-3-access')
  await chooseBaseSlot(page, 3, checkpoint)
  await confirmAllocation(page, [['Лаборатория', 1]], checkpoint)
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Образец: Cinder', exact: true }).click()
  await checkpoint()
  await page.getByRole('button', { name: 'Провести опыт: Aster → Cinder', exact: true }).click()
  await checkpoint()
  await checkpoint('final-model')
  await page.getByRole('button', { name: 'Отправить финальную модель', exact: true }).click()
  await checkpoint()
  if (awaitCompletion) {
    await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
    await expect(page.getByText(/Ваш учебный результат: 4 из 12/)).toBeVisible()
  }
}
