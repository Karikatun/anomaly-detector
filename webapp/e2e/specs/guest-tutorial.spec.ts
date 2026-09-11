import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { e2ePassword, expect, nextE2eClientIp, registerBrowserUser, test, uniqueLogin } from '../helpers/test'

const guestSessionKey = 'anomaly-detector:guest-tutorial-session'

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test.beforeEach(({ page }) => {
  page.setDefaultTimeout(15_000)
})

async function openGuestCompletion(page: Page) {
  await page.goto('/learn')
  await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  // The complete walkthrough is covered in tutorial.spec.ts. This fixture isolates the auth handoff.
  await page.evaluate((key) => {
    const serialized = sessionStorage.getItem(key)
    if (!serialized) throw new Error('Guest tutorial draft is missing')
    const state = JSON.parse(serialized)
    state.step = 'complete'
    sessionStorage.setItem(key, JSON.stringify(state))
  }, guestSessionKey)
  await page.reload()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`opens public learning without account operations at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const websiteUrl = process.env.E2E_WEBSITE_URL
    if (!websiteUrl) throw new Error('Public website origin is required')
    await page.goto(websiteUrl)
    await expect(page.getByRole('heading', { name: 'Разгадайте аномалию раньше соперников' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('landing.png'), fullPage: true })
    const protectedRequests: string[] = []
    page.on('request', (request) => {
      if (/\/api\/(rooms|profile|tenders)(\/|$)/.test(new URL(request.url()).pathname)) {
        protectedRequests.push(request.method())
      }
    })
    await page.getByRole('link', { name: 'Пройти обучение', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('guest-prologue.png') })
    await expect(page.getByRole('tab', { name: 'Регистрация' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
    await page.getByRole('button', { name: 'ПОНЯТНО, ДАЛЬШЕ' }).click()
    await expect(page.locator('[data-tutorial-step="round-1-header"]')).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-tutorial-step="round-1-header"]')).toBeVisible()
    expect(protectedRequests).toEqual([])
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'anomaly_detector_refresh')).toBe(false)
  })
}

test('registers after guest learning and saves completion without restarting the lesson', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': nextE2eClientIp() })
  await openGuestCompletion(page)
  await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Имя').fill('Гость после обучения')
  await page.getByLabel('Логин').fill(uniqueLogin('guest-tutorial'))
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/profile/tutorial/completion') && response.status() === 200)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  expect((await (await saved).json()).completedAt).toBeTruthy()
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toHaveCount(0)
  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' }).click()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeVisible()
  await page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' }).click()
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toBeVisible()
})

test('keeps guest completion through login, a failed save and reload', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Вернувшийся ученик', 'guest-login')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await openGuestCompletion(page)
  await page.getByRole('link', { name: 'Уже есть аккаунт', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.route('**/api/profile/tutorial/completion', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }),
  }))
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  await page.unroute('**/api/profile/tutorial/completion')
  await page.getByRole('button', { name: 'Сохранить отметку', exact: true }).click()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР' })).toBeEnabled()
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
test(`guest completion remains readable and keyboard accessible at ${viewport.width}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport)
  await openGuestCompletion(page)
  await expect(page.getByRole('link', { name: 'Создать аккаунт', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Уже есть аккаунт', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Создать аккаунт', exact: true })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('guest-complete.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
}

test('resumes completed guest learning after a same-tab external sign-in return', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Ученик внешнего входа', 'guest-provider')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await openGuestCompletion(page)
  await page.getByRole('link', { name: 'Уже есть аккаунт', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  const backendUrl = process.env.E2E_BACKEND_URL
  const webappUrl = process.env.E2E_WEB_URL
  const websiteUrl = process.env.E2E_WEBSITE_URL
  if (!backendUrl || !webappUrl || !websiteUrl) throw new Error('Test origins are required')
  // Model the provider boundary: leave the app, establish a real cookie session,
  // then return to the app root without a continuation query. No real Yandex account is used.
  await page.goto(websiteUrl)
  const response = await page.request.post(`${backendUrl}/api/auth/login`, {
    headers: { Origin: webappUrl },
    data: { login, password: e2ePassword },
  })
  expect(response.status()).toBe(200)
  await page.goto('/')
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' }).click()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeVisible()
})

test('a completion URL alone does not mark a lesson complete', async ({ page }) => {
  await registerBrowserUser(page, 'Ученик без прохождения', 'guest-no-marker')
  let completionWrites = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/profile/tutorial/completion')) completionWrites += 1
  })
  await page.goto('/?continue=tutorial-complete')
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toBeVisible()
  expect(completionWrites).toBe(0)
})

test('the public tutorial keeps the active-room guard for signed-in players', async ({ page }) => {
  await registerBrowserUser(page, 'Занятый игрок', 'guest-active-room')
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await page.getByLabel('Количество игроков').selectOption('2')
  await page.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
  await expect(page.getByRole('heading', { name: 'Лобби' })).toBeVisible()
  await page.goto('/learn')
  await expect(page.getByText('Сначала завершите активный Тендер', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться в матч' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
})
