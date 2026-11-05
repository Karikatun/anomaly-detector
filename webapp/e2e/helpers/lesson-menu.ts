import { expect, type Page } from '@playwright/test'

export async function openLessonFromMenu(page: Page, lesson: 'base' | 'additional' = 'base') {
  await page.getByRole('button', { name: 'Обучение', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Выберите урок', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: new RegExp(`^(Начать|Повторить|Открыть): ${lesson === 'base' ? 'Базовое' : 'Дополнительное'}$`) }).click()
}
