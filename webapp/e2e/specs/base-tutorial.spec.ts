import { gameContractVersionHeader } from '@anomaly-detector/contracts'
import { e2ePassword, expect, nextE2eClientIp, test, uniqueLogin } from '../helpers/test'
import { baseGuestSessionKey, chooseBaseSlot, confirmAllocation, playBaseTutorial } from '../helpers/base-tutorial'

test.use({ trace: 'off', video: 'off' })

test('guest completes base, saves through registration and finishes the first accepted simple round without analytics', async ({ page }) => {
  test.setTimeout(150_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': nextE2eClientIp() })
  const guestProtected: string[] = []
  const completionEvents: string[] = []
  let guest = true
  page.on('requestfailed', (request) => console.log('base-network-failure', new URL(request.url()).origin, new URL(request.url()).pathname, request.failure()?.errorText))
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (guest && /^\/api\/(?:rooms|profile|tenders)(?:\/|$)/.test(path)) guestProtected.push(path)
    if (path === '/api/analytics/events' && /tutorial_complete|base.*complete|additional.*complete/.test(request.postData() ?? '')) completionEvents.push(request.postData() ?? '')
  })
  let previous = 0
  await playBaseTutorial(page, true, async (step) => {
    if (!step) return
    const indicator = page.getByText(/^Шаг \d+ из 12$/, { exact: true })
    await expect(indicator.first()).toBeVisible()
    const text = await indicator.first().innerText()
    const current = Number(text.match(/^Шаг (\d+) из 12$/)?.[1])
    expect(current).toBeGreaterThanOrEqual(previous)
    previous = current
    if (step === 'round-1-thesis') {
      const signal = page.getByLabel('Сигнал для тезиса', { exact: true })
      await signal.press('a')
      await expect(signal).toHaveValue('aster')
    }
    if (step === 'round-1-thesis-review') {
      expect(current).toBe(11)
      const attempts = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '{}').state?.thesisAttempts, baseGuestSessionKey)
      expect(attempts).toBe(0)
      await page.reload()
      const field = page.getByLabel('Тип поля для тезиса', { exact: true })
      await expect(field).toHaveValue('inertial')
      await field.selectOption('phase')
      await expect(field).toHaveValue('phase')
      await page.reload()
      await expect(field).toHaveValue('phase')
      await field.selectOption('inertial')
      await expect(field).toHaveValue('inertial')
    }
    if (step === 'round-1-thesis-result') {
      expect(current).toBe(11)
      await expect(page.getByTestId('floater').getByRole('status')).toHaveText('Тип поля верен. Полярность верна.')
    }
    if (step === 'final-model') expect(current).toBe(12)
  })
  await expect(page.getByText(/Ваш учебный результат: 2 из 12/)).toBeVisible()
  expect(guestProtected).toEqual([])
  expect(completionEvents).toEqual([])
  guest = false
  await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Имя').fill('Ученик базовой практики')
  await page.getByLabel('Логин').fill(uniqueLogin('base-practice'))
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress') && response.status() === 200)
  const registered = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/auth/register') && response.status() === 201)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  const registration = await registered
  const session = await registration.json() as { accessToken: string }
  const apiOrigin = new URL(registration.url()).origin
  const progress = await (await saved).json()
  expect(progress.base.completion).toMatchObject({ origin: 'scenario', scenarioVersion: 'base-simple-v1' })
  expect(progress.base.legacyCredit).toBeNull()
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  const reloadedSave = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress') && response.status() === 200)
  await page.reload()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  expect((await (await reloadedSave).json()).base.completion.completedAt).toBe(progress.base.completion.completedAt)
  await page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР', exact: true }).click()
  await expect(page.getByLabel('Режим игры', { exact: true })).toHaveValue('simple')
  await page.getByRole('checkbox', { name: 'Возможность добавить ботов', exact: true }).check()
  await page.getByRole('button', { name: 'Создать команду', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить лёгкого бота', exact: true }).click()
  await page.getByRole('button', { name: 'Готов', exact: true }).click()
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click()
  await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
  const tenderId = page.url().split('/').at(-1)!
  const acceptedTypes: string[] = []
  page.on('response', (response) => {
    if (response.status() === 200 && response.request().method() === 'POST' && response.url().endsWith(`/api/tenders/${tenderId}/commands`)) {
      acceptedTypes.push(response.request().postDataJSON().type)
    }
  })
  await chooseBaseSlot(page, 6)
  await confirmAllocation(page, [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]])
  await page.locator('[data-tutorial-recon-target][data-state="available"]').first().click()
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click()
  await page.getByRole('button', { name: /^Глубокое/ }).click()
  const samples = page.locator('[data-tutorial-lab-sample]')
  await expect(samples).toHaveCount(2)
  await samples.nth(0).click()
  await samples.nth(1).click()
  await page.getByRole('button', { name: /^Провести опыт:/ }).click()
  await page.getByLabel('Сигнал для тезиса', { exact: true }).selectOption({ index: 1 })
  await page.getByLabel('Тип поля для тезиса', { exact: true }).selectOption('inertial')
  await page.getByLabel('Полярность для тезиса', { exact: true }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис', exact: true }).click()
  await expect.poll(async () => {
    const response = await page.request.get(`${apiOrigin}/api/tenders/${tenderId}`, { headers: { Authorization: `Bearer ${session.accessToken}`, [gameContractVersionHeader]: '2' } })
    expect(response.ok()).toBe(true)
    const view = await response.json()
    expect(view.game).toMatchObject({ mode: 'simple', rounds: 3, powerPerRound: 4, contracts: false })
    return view.round
  }, { timeout: 30_000 }).toBe(2)
  await expect(page.getByText('Раунд 2 / 3', { exact: true })).toBeVisible()
  expect(acceptedTypes).toEqual(expect.arrayContaining(['request-access-slot', 'allocate-power', 'conduct-reconnaissance', 'run-laboratory-test', 'submit-thesis']))
  expect(completionEvents).toEqual([])
})


test('base lesson rolls back an access choice across reload and allows replay', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await page.goto('/learn')
  await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  await chooseBaseSlot(page, 6)
  await expect(page.locator('[data-tutorial-step="round-1-power"]')).toBeVisible()
  const back = page.getByRole('button', { name: 'Назад', exact: true })
  await back.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-tutorial-step="round-1-access"]')).toBeVisible()
  await expect(back).toBeFocused()
  await page.reload()
  await expect(page.locator('[data-tutorial-step="round-1-access"]')).toBeVisible()
  await chooseBaseSlot(page, 6)
  await expect(page.locator('[data-tutorial-step="round-1-power"]')).toBeVisible()
})
