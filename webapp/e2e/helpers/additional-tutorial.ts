import { expect, type Page } from '@playwright/test'
import { chooseBaseSlot, confirmAllocation, selectTutorialThesis } from './base-tutorial'

export type AdditionalCheckpoint = (name: string) => Promise<void>
const noCheckpoint: AdditionalCheckpoint = async () => undefined

async function submitAdditionalThesis(page: Page, signal: string, fieldType: string, polarity: string) {
  await selectTutorialThesis(page, signal, fieldType, polarity)
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
}

// Actions use the documented prepared fixture, never hidden scenario state or stored answers.
export async function reachAdditionalContracts(page: Page, checkpoint: AdditionalCheckpoint = noCheckpoint, current = false, researchMode: 'deep' | 'broad' = 'deep') {
  if (!current) await page.goto('/learn?lesson=additional')
  await page.getByRole('button', { name: 'Начать дополнительный урок', exact: true }).click()
  await page.getByRole('button', { name: 'Планировать лёгкий контракт', exact: true }).click()
  await chooseBaseSlot(page, 4)
  await expect(page.locator('[data-additional-step="power"]')).toBeVisible()
  await checkpoint('main-power')
  await confirmAllocation(page, [['Лаборатория', 2], ['Анализ модели', 1], ['Контракты', 1]])
  await page.getByRole('button', { name: researchMode === 'deep' ? /^Глубокое/ : /^Широкое/ }).click()
  await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
  await page.getByRole('button', { name: 'Образец: Boreal', exact: true }).click()
  if (researchMode === 'deep') await page.getByRole('button', { name: 'Провести опыт: Aster → Boreal', exact: true }).click()
  else {
    await page.getByRole('button', { name: 'Сохранить первую пару', exact: true }).click()
    await page.getByRole('button', { name: 'Образец: Aster', exact: true }).click()
    await page.getByRole('button', { name: 'Образец: Eclipse', exact: true }).click()
    await page.getByRole('button', { name: 'Провести два опыта', exact: true }).click()
  }
  await submitAdditionalThesis(page, 'cinder', 'phase', 'negative')
  await expect(page.locator('[data-additional-step="review-intro"]')).toBeVisible()
  await checkpoint('first-certification')
  await page.getByRole('button', { name: 'Разобрать цену ошибки', exact: true }).click()
  await confirmAllocation(page, [['Лаборатория', 1], ['Анализ модели', 2], ['Контракты', 1]])
  await submitAdditionalThesis(page, 'aster', 'phase', 'positive')
  await checkpoint('controlled-wrong')
  await submitAdditionalThesis(page, 'aster', 'inertial', 'positive')
  await expect(page.locator('[data-additional-step="review-result"]')).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться к основной сцене', exact: true }).click()
  await expect(page.locator('[data-additional-step="contracts"]')).toBeVisible()
  await checkpoint('main-contracts')
}

export async function confirmAdditionalContract(page: Page, contractId: string, evidence: string | 'certification' = 'first') {
  const card = page.locator(`[data-contract-id="${contractId}"]`)
  if (evidence === 'certification') await card.getByRole('combobox').selectOption('aster')
  else await card.getByRole('combobox').first().selectOption({ index: 1 })
  await card.getByRole('button', { name: /^Подтвердить контракт:/ }).click()
}


export async function playAdditionalTutorial(page: Page, checkpoint: AdditionalCheckpoint = noCheckpoint, current = false, awaitCompletion = true) {
  await reachAdditionalContracts(page, checkpoint, current)
  await confirmAdditionalContract(page, 'lesson-light')
  await expect(page.locator('[data-additional-step="contract-result"]')).toBeVisible()
  await checkpoint('main-awarded')
  await page.getByRole('button', { name: 'Разобрать сбой подачи', exact: true }).click()
  await confirmAdditionalContract(page, 'lesson-light')
  await expect(page.getByRole('alert').first()).toContainText('Учебный сбой')
  await checkpoint('reserved-retry')
  const reserved = page.locator('[data-contract-id="lesson-light"]')
  await expect(reserved).toContainText('Зарезервирован · вами')
  await reserved.getByRole('button', { name: /^Подтвердить контракт:/ }).click()
  await expect(page.locator('[data-additional-step="recovery-result"]')).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться к основной сцене', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть подготовленный пятый раунд', exact: true }).click()
  await checkpoint('late-final')
  await confirmAdditionalContract(page, 'final-contract')
  await expect(page.locator('[data-additional-step="final-contract-result"]')).toBeVisible()
  await page.getByRole('button', { name: 'Перейти к финальной модели', exact: true }).click()
  await checkpoint('own-final')
  await page.getByRole('button', { name: 'Отправить финальную модель', exact: true }).click()
  if (awaitCompletion) await expect(page.getByText('Дополнительное обучение завершено', { exact: true })).toBeVisible()
}
