import { reachAdditionalContracts, confirmAdditionalContract, playAdditionalTutorial } from '../helpers/additional-tutorial'
import { e2ePassword, expect, nextE2eClientIp, registerBrowserUser, test, uniqueLogin } from '../helpers/test'

test.use({ trace: 'off', video: 'off' })

test('main-menu lesson chooser closes to its opener without starting a lesson or writing progress', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await registerBrowserUser(page, 'Выбор учебной практики', 'lesson-dialog')
  let writes = 0
  let completionEvents = 0
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'PUT' && path === '/api/profile/tutorial/progress') writes += 1
    if (path === '/api/analytics/events' && /tutorial_complete|additional.*complete/.test(request.postData() ?? '')) completionEvents += 1
  })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const opener = page.getByRole('button', { name: 'Обучение', exact: true })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Выберите урок', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Базовое', exact: true })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Дополнительное', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Начать: Базовое', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: 'Начать: Дополнительное', exact: true })).toBeEnabled()
    for (let key = 0; key < 5; key += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect(page).toHaveURL('/')
  }
  expect(writes).toBe(0)
  expect(completionEvents).toBe(0)
})


test('additional lesson opens its prepared standard contract plan directly', async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000)
  await page.goto('/learn?lesson=additional')
  await expect(page.getByRole('heading', { name: 'Дополнительное обучение: ресурсы и контракты', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать дополнительный урок', exact: true }).click()
  await expect(page.locator('[data-additional-step="plan"]')).toBeVisible()
  await page.getByRole('button', { name: /^Контракты этого раунда/ }).click()
  const plan = page.getByRole('dialog', { name: /^Контракты этого раунда/ })
  await expect(plan).toBeVisible()
  await expect(plan).toContainText('Aster')
  await expect(plan).toContainText('научный')
  await page.screenshot({ path: testInfo.outputPath('additional-plan-first.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(plan).toBeHidden()
  await expect(page.getByRole('button', { name: /^Контракты этого раунда/ })).toBeFocused()
})


test('additional prepared resources lead through review to one accepted contract', async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000)
  await reachAdditionalContracts(page, async (step) => {
    if (step === 'main-power') await expect(page.getByText('3 M', { exact: false }).first()).toBeVisible()
    if (step === 'main-contracts') await page.screenshot({ path: testInfo.outputPath('additional-contracts-first.png'), fullPage: true })
  })
  await confirmAdditionalContract(page, 'lesson-light')
  await expect(page.locator('[data-additional-step="contract-result"]')).toBeVisible()
  await expect(page.locator('[data-additional-step="contract-result"]')).toContainText('4')
})


test('additional full guest lesson retains a reserved bid for retry and reaches its own final model', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await playAdditionalTutorial(page)
})


test('additional guest completion signs in to the selected lesson and preserves its server date on reload', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': nextE2eClientIp() })
  const completions: string[] = []
  const analytics: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/profile/tutorial/progress')) completions.push(request.postDataJSON().lessonId)
    if (new URL(request.url()).pathname === '/api/analytics/events') analytics.push(request.postData() ?? '')
  })
  await playAdditionalTutorial(page)
  await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Имя').fill('Дополнительный исследователь')
  await page.getByLabel('Логин').fill(uniqueLogin('extra-signin'))
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress') && response.status() === 200)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  const result = await (await saved).json()
  expect(result.additional.completion.scenarioVersion).toBe('additional-standard-v1')
  expect(result.base.completion).toBeNull()
  expect(result.base.legacyCredit).toBeNull()
  await expect(page).toHaveURL('/tutorial?lesson=additional')
  await expect(page.getByText('Дополнительное обучение завершено', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Дополнительное обучение завершено', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР', exact: true }).click()
  await expect(page.getByLabel('Режим игры')).toHaveValue('standard')
  expect(completions.every((lessonId) => lessonId === 'additional')).toBe(true)
  expect(analytics.filter((payload) => /tutorial_complete|additional.*complete/.test(payload))).toEqual([])
})


for (const viewport of [{ width: 1440, height: 900, scale: 1 }, { width: 1024, height: 768, scale: 1 }, { width: 390, height: 844, scale: 2 }]) {
  test(`additional lesson remains operable at ${viewport.width} with ${viewport.scale * 100}% text`, async ({ page }, testInfo) => {
    page.setDefaultTimeout(15_000)
    await page.setViewportSize(viewport)
    await page.goto('/learn?lesson=additional')
    await page.evaluate((scale) => { document.documentElement.style.fontSize = `${scale * 100}%` }, viewport.scale)
    await playAdditionalTutorial(page, async (step) => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (['main-contracts', 'reserved-retry', 'own-final'].includes(step)) await page.screenshot({ path: testInfo.outputPath(`${step}.png`), fullPage: true })
    }, true)
    await expect(page.getByRole('link', { name: 'Создать аккаунт', exact: true })).toBeEnabled()
  })
}


test('additional lesson rolls back an awarded contract across reload and allows replay', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await reachAdditionalContracts(page)
  await confirmAdditionalContract(page, 'lesson-light')
  await expect(page.locator('[data-additional-step="contract-result"]')).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.locator('[data-additional-step="contracts"]')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-additional-step="contracts"]')).toBeVisible()
  await confirmAdditionalContract(page, 'lesson-light')
  await expect(page.locator('[data-additional-step="contract-result"]')).toBeVisible()
})
