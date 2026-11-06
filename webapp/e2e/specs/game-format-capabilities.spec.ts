import { gameCapabilitiesSchema } from '@anomaly-detector/contracts'
import { playAdditionalTutorial } from '../helpers/additional-tutorial'
import { openLessonFromMenu } from '../helpers/lesson-menu'
import { expect, registerBrowserUser, test } from '../helpers/test'

test('a capability request failure leaves only standard room creation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/capabilities', (route) => route.abort())
  await registerBrowserUser(page, 'Проверка режима комнаты', 'room-capability')

  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Создать команду', exact: true })
  const mode = dialog.getByLabel('Режим игры')
  await expect(mode).toHaveValue('standard')
  await expect(mode.locator('option[value="simple"]')).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('standard-room-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(mode).toBeVisible()
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('standard-room-mobile.png') })

  const created = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/rooms' && response.ok())
  await dialog.getByRole('button', { name: 'Создать команду', exact: true }).click()
  expect((await (await created).json()).mode).toBe('standard')
  await expect(page).toHaveURL(/\/rooms\/[^/]+$/)
})

test('closed lesson writes preserve local completion without a profile write', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch()
    if (!response.ok()) throw new Error('Expected the capabilities endpoint to respond')
    const capabilities = gameCapabilitiesSchema.parse(await response.json())
    if (!capabilities.newGameFormatWritesEnabled) return route.fulfill({ response })
    return route.fulfill({
      json: { newGameFormatWritesEnabled: false },
      headers: { 'access-control-allow-origin': '*' },
    })
  })
  await registerBrowserUser(page, 'Локальный результат урока', 'lesson-capability')
  const progressWrites: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'PUT' && path.startsWith('/api/profile/tutorial/')) progressWrites.push(path)
  })
  await openLessonFromMenu(page, 'additional')
  await playAdditionalTutorial(page, undefined, true, false)
  await expect(page.getByText('Сохранить отметку в профиле пока нельзя.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('local-lesson-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByText('Сохранить отметку в профиле пока нельзя.')).toBeVisible()
  expect(progressWrites).toEqual([])
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('local-lesson-mobile.png') })
})
