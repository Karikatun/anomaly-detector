import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { e2ePassword, expect, nextE2eClientIp, registerBrowserUser, test, uniqueLogin } from '../helpers/test'
import { playBaseTutorial } from '../helpers/base-tutorial'

const guestSessionKey = 'anomaly-detector:tutorial:base:base-simple-v1:tutorial-guest'

test.use({ screenshot: 'off', trace: 'off', video: 'off' })

test.beforeEach(({ page }) => {
  page.setDefaultTimeout(15_000)
})

async function openGuestCompletion(page: Page) {
  await page.goto('/learn')
  await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), guestSessionKey)).not.toBeNull()
  // The real deduction walkthrough is covered in base-tutorial.spec.ts. This fixture isolates the auth handoff.
  await page.evaluate((key) => {
    const serialized = sessionStorage.getItem(key)
    if (!serialized) throw new Error('Guest tutorial draft is missing')
    const state = JSON.parse(serialized)
    state.step = 'complete'
    state.round = 3
    state.independentCycle = true
    state.finalSubmission = { signals: { aster: { fieldType: 'inertial', polarity: 'positive' }, cinder: { fieldType: 'phase', polarity: 'negative' } } }
    state.finalDraft = state.finalSubmission
    state.rating = 4
    sessionStorage.setItem(key, JSON.stringify(state))
  }, guestSessionKey)
  await page.reload()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
}

for (const signedIn of [false, true]) {
for (const width of [1440, 390]) {
  test(`public learning exits to the website with signedIn=${signedIn} at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const websiteUrl = process.env.E2E_WEBSITE_URL
    if (!websiteUrl) throw new Error('Public website origin is required')
    if (signedIn) await registerBrowserUser(page, 'Ученик с сессией', 'guest-exit')
    for (const startLesson of [false, true]) {
      await page.goto(websiteUrl)
      await page.getByRole('link', { name: 'Пройти обучение', exact: true }).first().click()
      const prologue = page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию' })
      await expect(prologue).toBeVisible()
      if (startLesson) {
        await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
        await page.locator('[data-testid="floater"]').getByRole('button', { name: 'Выйти из обучения', exact: true }).click()
        await page.getByRole('button', { name: 'Выйти и сбросить', exact: true }).click()
      } else {
        await prologue.getByRole('button', { name: 'Вернуться на сайт', exact: true }).click()
      }
      await expect(page).toHaveURL(`${websiteUrl}/`)
      await expect(page.getByRole('heading', { name: 'Разгадайте аномалию раньше соперников' })).toBeVisible()
    }
    if (signedIn) {
      await page.goto('/tutorial')
      await page.getByRole('button', { name: 'Вернуться в главное меню', exact: true }).click()
      await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
    } else {
      expect((await page.context().cookies()).some((cookie) => cookie.name === 'anomaly_detector_refresh')).toBe(false)
      const backendUrl = process.env.E2E_BACKEND_URL
      const webappUrl = process.env.E2E_WEB_URL
      if (!backendUrl || !webappUrl) throw new Error('API and app origins are required')
      const headers = { Origin: webappUrl }
      const roomId = '00000000-0000-4000-8000-000000000001'
      for (const path of [`/api/rooms/${roomId}`, `/api/tenders/${roomId}`, '/api/profile']) {
        expect((await page.request.get(`${backendUrl}${path}`, { headers })).status()).toBe(401)
      }
      for (const [path, data] of [
        ['/api/rooms', { capacity: 2, allowBots: true }],
        [`/api/rooms/${roomId}/start`, {}],
        [`/api/tenders/${roomId}/commands`, {}],
        ['/api/profile/tutorial/progress', {}],
      ] as const) {
        expect((await page.request.post(`${backendUrl}${path}`, { headers, data })).status()).toBe(401)
      }
      for (const path of ['/', '/tutorial', '/rooms/00000000-0000-4000-8000-000000000001', '/tenders/00000000-0000-4000-8000-000000000001']) {
        await page.goto(path)
        await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toHaveCount(0)
      }
    }
  })
}
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
    await expect(page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('guest-prologue.png') })
    await expect(page.getByRole('tab', { name: 'Регистрация' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
    await expect(page.locator('[data-tutorial-step="round-1-access"]')).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-tutorial-step="round-1-access"]')).toBeVisible()
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
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress') && response.status() === 200)
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  expect((await (await saved).json()).base.completion.completedAt).toBeTruthy()
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию' })).toHaveCount(0)
  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' }).click()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeVisible()
  await page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' }).click()
  await expect(page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию' })).toBeVisible()
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
  await page.route('**/api/profile/tutorial/progress', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }),
  }))
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  await page.unroute('**/api/profile/tutorial/progress')
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
    if (request.method() === 'PUT' && request.url().endsWith('/api/profile/tutorial/progress')) completionWrites += 1
  })
  await page.goto('/?continue=tutorial-complete')
  await expect(page).toHaveURL('/tutorial')
  await expect(page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию' })).toBeVisible()
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

test('blocked sessionStorage permits real base practice and ordinary registration without a fabricated transfer', async ({ page }) => {
  test.setTimeout(120_000)
  await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': nextE2eClientIp() })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } })
  })
  let completionWrites = 0
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/profile/tutorial/progress')) completionWrites += 1
  })
  await playBaseTutorial(page, true, false)
  await expect(page.getByText(/Хранилище вкладки недоступно/)).toBeVisible()
  await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click()
  await expect(page).toHaveURL('/?auth=register')
  await expect(page.getByRole('tab', { name: 'Регистрация', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Имя').fill('Практика без хранилища')
  await page.getByLabel('Логин').fill(uniqueLogin('base-storage-off'))
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true })).toBeVisible()
  expect(completionWrites).toBe(0)
})

test('a pending guest save remains with its first account through logout, a second account and reload', async ({ page }) => {
  const firstAccount = await registerBrowserUser(page, 'Первый аккаунт практики', 'base-first-account')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await openGuestCompletion(page)
  await page.getByRole('link', { name: 'Уже есть аккаунт', exact: true }).click()
  await page.getByLabel('Логин').fill(firstAccount.login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.route('**/api/profile/tutorial/progress', (route) => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }) })
    : route.continue())
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await registerBrowserUser(page, 'Второй аккаунт практики', 'base-second-account')
  let secondAccountWrites = 0
  const observe = (request: import('@playwright/test').Request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/profile/tutorial/progress')) secondAccountWrites += 1
  }
  page.on('request', observe)
  await page.goto('/?continue=tutorial-complete')
  await expect(page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Базовое обучение: исследуйте аномалию', exact: true })).toBeVisible()
  expect(secondAccountWrites).toBe(0)
  page.off('request', observe)
  await page.goto('/')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await page.goto('/?continue=tutorial-complete&auth=login')
  await page.getByLabel('Логин').fill(firstAccount.login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.unroute('**/api/profile/tutorial/progress')
  const saved = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress') && response.status() === 200)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  expect((await (await saved).json()).base.completion.scenarioVersion).toBe('base-simple-v1')
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
})

for (const delivery of ['before', 'after'] as const) {
test(`a delayed legacy entry save delivered ${delivery} actual completion cannot consume a new voluntary base run`, async ({ page }) => {
  await page.goto('/learn')
  await expect(page.getByRole('button', { name: 'Начать обучение', exact: true })).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('anomaly-detector:guest-tutorial-session', JSON.stringify({
    budget: 2, corporateTrust: 0, hintLevel: 0, playerId: 'tutorial-guest', privateTheses: [], rating: 0,
    round: 2, step: 'complete', thesisAttempts: 0, workingModel: { signals: {} },
  })))
  await page.reload()
  await page.getByRole('link', { name: 'Создать аккаунт', exact: true }).click()
  let releaseLegacy!: () => void
  const legacyDelivery = new Promise<void>((resolve) => { releaseLegacy = resolve })
  let legacyStored!: () => void
  const storedLegacy = new Promise<void>((resolve) => { legacyStored = resolve })
  let deliveredLegacy!: () => void
  const legacyDelivered = new Promise<void>((resolve) => { deliveredLegacy = resolve })
  await page.route('**/api/profile/tutorial/progress', async (route) => {
    if (route.request().method() !== 'PUT' || route.request().postDataJSON().kind !== 'legacy-credit') return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    const historical = await response.json()
    expect(historical.base.legacyCredit).toEqual({ origin: 'legacy', completedAt: null })
    expect(historical.base.completion).toBeNull()
    legacyStored()
    await legacyDelivery
    await route.fulfill({ response })
    deliveredLegacy()
  })
  await page.getByLabel('Имя').fill('Повтор после старого обучения')
  await page.getByLabel('Логин').fill(uniqueLogin('legacy-repeat-race'))
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await storedLegacy
  await page.getByRole('button', { name: 'Пройти новый базовый урок', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Начать обучение', exact: true })).toBeVisible()
  if (delivery === 'before') { releaseLegacy(); await legacyDelivered }
  const actualSave = page.waitForResponse((response) => response.request().method() === 'PUT'
    && response.url().endsWith('/api/profile/tutorial/progress')
    && response.request().postDataJSON().kind === 'scenario-completed')
  await playBaseTutorial(page, 'current')
  const actual = await (await actualSave).json()
  if (delivery === 'after') {
    const lateResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress') && response.request().postDataJSON().kind === 'legacy-credit')
    releaseLegacy()
    await legacyDelivered
    await (await lateResponse).finished()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  expect(actual.base.legacyCredit).toEqual({ origin: 'legacy', completedAt: null })
  expect(actual.base.completion).toMatchObject({ origin: 'scenario', scenarioVersion: 'base-simple-v1' })
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Новая базовая практика пройдена:/)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Сохраняем' })).toHaveCount(0)
})
}

test('an initial progress GET delivered after actual completion cannot erase its visible server fact', async ({ page }) => {
  await registerBrowserUser(page, 'Поздний ответ чтения', 'base-read-race')
  let releaseRead!: () => void
  const delivery = new Promise<void>((resolve) => { releaseRead = resolve })
  let readStored!: () => void
  const storedRead = new Promise<void>((resolve) => { readStored = resolve })
  let held = false
  await page.route('**/api/profile/tutorial/progress', async (route) => {
    if (route.request().method() !== 'GET' || held) return route.continue()
    held = true
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    expect((await response.json()).base.completion).toBeNull()
    readStored()
    await delivery
    await route.fulfill({ response })
  })
  await page.goto('/tutorial')
  await storedRead
  const actualSave = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/api/profile/tutorial/progress'))
  await playBaseTutorial(page, 'current')
  expect((await (await actualSave).json()).base.completion.scenarioVersion).toBe('base-simple-v1')
  const lateResponse = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith('/api/profile/tutorial/progress'))
  releaseRead()
  await (await lateResponse).finished()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByText(/^Новая базовая практика пройдена:/)).toBeVisible()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
})
