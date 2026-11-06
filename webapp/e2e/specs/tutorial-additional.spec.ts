import type { Page } from '@playwright/test'
import type { TutorialLessonId, TutorialLessonsProgress } from '@anomaly-detector/contracts'
import { playAdditionalTutorial, reachAdditionalContracts } from '../helpers/additional-tutorial'
import { playBaseTutorial } from '../helpers/base-tutorial'
import { openLessonFromMenu } from '../helpers/lesson-menu'
import { e2ePassword, expect, registerBrowserUser, test } from '../helpers/test'

test.use({ trace: 'off', video: 'off' })
test.beforeEach(({ page }) => { page.setDefaultTimeout(15_000) })

type Account = { login: string; apiOrigin: string; accessToken: string }
async function registerAccount(page: Page, prefix: string): Promise<Account> {
  const registration = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().endsWith('/api/auth/register') && response.status() === 201)
  const { login } = await registerBrowserUser(page, 'Участник дополнительной практики', prefix)
  const response = await registration
  const { accessToken } = await response.json() as { accessToken: string }
  return { login, apiOrigin: new URL(response.url()).origin, accessToken }
}
async function readProgress(page: Page, account: Account): Promise<TutorialLessonsProgress> {
  const response = await page.request.get(`${account.apiOrigin}/api/profile/tutorial/progress`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
  })
  expect(response.status()).toBe(200)
  return await response.json() as TutorialLessonsProgress
}
function additionalSaved(page: Page) {
  return page.waitForResponse((response) => response.request().method() === 'PUT'
    && response.url().endsWith('/api/profile/tutorial/progress')
    && response.request().postDataJSON().lessonId === 'additional' && response.status() === 200)
}
async function login(page: Page, account: Account) {
  const signedIn = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().endsWith('/api/auth/login') && response.status() === 200)
  await page.getByLabel('Логин').fill(account.login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  account.accessToken = (await (await signedIn).json() as { accessToken: string }).accessToken
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
}
async function playCurrentLesson(page: Page, lessonId: TutorialLessonId, awaitCompletion = true) {
  if (lessonId === 'additional') await playAdditionalTutorial(page, undefined, true, awaitCompletion)
  else await playBaseTutorial(page, 'current', undefined, undefined, awaitCompletion)
}

test('additional Broad collects two impulse proofs for one Complex contract', async ({ page }) => {
  await reachAdditionalContracts(page, undefined, false, 'broad')
  await page.getByRole('button', { name: 'Открыть журнал', exact: true }).click()
  const journal = page.getByRole('dialog', { name: 'Журнал исследований', exact: true })
  await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
  await expect(journal.getByRole('tab', { name: 'Данные исследований', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(journal.getByRole('heading', { name: 'Личные измерения', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const contract = page.locator('[data-contract-id="lesson-complex"]')
  const primary = contract.getByRole('combobox').nth(0)
  const secondary = contract.getByRole('combobox').nth(1)
  await primary.selectOption({ label: 'Aster → Boreal · Отражение · импульсный' })
  await expect(secondary).toBeEnabled()
  await secondary.selectOption({ label: 'Aster → Eclipse · Нестабильный срыв · импульсный' })
  expect(await primary.inputValue()).not.toBe(await secondary.inputValue())
  await contract.getByRole('button', { name: /^Подтвердить контракт:/ }).click()
  const result = page.locator('[data-additional-step="contract-result"]')
  await expect(result).toBeVisible()
  await expect(result).toContainText('Контракт принят')
  await expect(result).toContainText('Бюджет: 3. Рейтинг: 6. Доверие: 2.')
})

test('account additional practice preserves base facts and its first server date through reload and repeat', async ({ page }) => {
  const account = await registerAccount(page, 'additional-repeat')
  // These real server writes are existing-account setup, not proof of a lesson.
  const headers = { Authorization: `Bearer ${account.accessToken}` }
  expect((await page.request.put(`${account.apiOrigin}/api/profile/tutorial/completion`, { headers })).status()).toBe(200)
  expect((await page.request.put(`${account.apiOrigin}/api/profile/tutorial/progress`, {
    headers, data: { kind: 'scenario-completed', lessonId: 'base', scenarioVersion: 'base-simple-v1' },
  })).status()).toBe(200)
  const before = await readProgress(page, account)
  const writes: unknown[] = []
  const analytics: string[] = []
  const createdRooms: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'PUT' && path.startsWith('/api/profile/tutorial')) writes.push(request.postDataJSON())
    if (request.method() === 'POST' && path === '/api/analytics/events') analytics.push(path)
    if (request.method() === 'POST' && path === '/api/rooms') createdRooms.push(path)
  })
  await openLessonFromMenu(page, 'additional')
  const saved = additionalSaved(page)
  await playAdditionalTutorial(page, undefined, true)
  const first = await (await saved).json() as TutorialLessonsProgress
  expect(first.base).toEqual(before.base)
  expect(first.additional.completion).toEqual({ origin: 'scenario', scenarioVersion: 'additional-standard-v1', completedAt: expect.any(String) })
  await page.reload()
  await expect(page.getByText('Дополнительное обучение завершено', { exact: true })).toBeVisible()
  expect(await readProgress(page, account)).toEqual(first)
  await page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ', exact: true }).click()
  const repeated = additionalSaved(page)
  await playAdditionalTutorial(page, undefined, true)
  expect(await (await repeated).json()).toEqual(first)
  await page.getByRole('button', { name: 'СОЗДАТЬ НАСТОЯЩИЙ ТЕНДЕР', exact: true }).click()
  await expect(page.getByLabel('Режим игры', { exact: true })).toHaveValue('standard')
  expect(createdRooms).toEqual([])
  expect(writes.length).toBeGreaterThanOrEqual(2)
  for (const command of writes) expect(command).toEqual({ kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1' })
  expect(analytics).toEqual([])
})

for (const firstLesson of ['base', 'additional'] as const) {
  test(`late ${firstLesson} response cannot replace the other lesson after native navigation`, async ({ page }) => {
    const account = await registerAccount(page, `lesson-order-${firstLesson}`)
    const secondLesson = firstLesson === 'base' ? 'additional' : 'base'
    let release!: () => void
    let received!: (progress: TutorialLessonsProgress) => void
    let settled!: () => void
    const releaseResponse = new Promise<void>((resolve) => { release = resolve })
    const heldResponse = new Promise<TutorialLessonsProgress>((resolve) => { received = resolve })
    const delivered = new Promise<void>((resolve) => { settled = resolve })
    let holding = false
    await page.route('**/api/profile/tutorial/progress', async (route) => {
      if (route.request().method() !== 'PUT' || route.request().postDataJSON().lessonId !== firstLesson || holding) return route.continue()
      holding = true
      // The server accepts the real command. Only its browser delivery is late.
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      received(await response.json() as TutorialLessonsProgress)
      await releaseResponse
      try { await route.fulfill({ response }) } finally { settled() }
    })
    try {
      await openLessonFromMenu(page, firstLesson)
      await playCurrentLesson(page, firstLesson, false)
      const early = await heldResponse
      expect(early[firstLesson].completion).not.toBeNull()
      expect(early[secondLesson].completion).toBeNull()
      await expect(page.getByText('Сохраняем результат обучения', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ', exact: true }).click()
      await openLessonFromMenu(page, secondLesson)
      const secondSaved = page.waitForResponse((response) => response.request().method() === 'PUT'
        && response.url().endsWith('/api/profile/tutorial/progress')
        && response.request().postDataJSON().lessonId === secondLesson && response.status() === 200)
      await playCurrentLesson(page, secondLesson)
      const complete = await (await secondSaved).json() as TutorialLessonsProgress
      expect(complete[firstLesson].completion).toEqual(early[firstLesson].completion)
      expect(complete[secondLesson].completion).not.toBeNull()
      const secondTitle = secondLesson === 'base' ? 'Обучение завершено' : 'Дополнительное обучение завершено'
      const dateText = secondLesson === 'base' ? /^Новая базовая практика пройдена:/ : /^Дополнительный урок пройден:/
      await expect(page.getByText(dateText)).toBeVisible()
      release()
      await delivered
      await expect(page.getByText(secondTitle, { exact: true })).toBeVisible()
      await expect(page.getByText(dateText)).toBeVisible()
      expect(await readProgress(page, account)).toEqual(complete)
      await page.reload()
      await expect(page.getByText(secondTitle, { exact: true })).toBeVisible()
      expect(await readProgress(page, account)).toEqual(complete)
    } finally { release() }
  })
}

test('a failed additional guest claim stays with its first account across account changes', async ({ page }) => {
  const first = await registerAccount(page, 'additional-first-owner')
  await logout(page)
  const second = await registerAccount(page, 'additional-next-owner')
  await logout(page)
  await playAdditionalTutorial(page)
  await page.getByRole('link', { name: 'Уже есть аккаунт', exact: true }).click()
  let failedClaims = 0
  await page.route('**/api/profile/tutorial/progress', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    failedClaims += 1
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }) })
  })
  await login(page, first)
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  const firstClaims = failedClaims
  expect(firstClaims).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ', exact: true }).click()
  await logout(page)
  await login(page, second)
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true })).toBeVisible()
  await openLessonFromMenu(page, 'additional')
  await expect(page.getByRole('button', { name: 'Начать дополнительный урок', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toHaveCount(0)
  expect(failedClaims).toBe(firstClaims)
  expect((await readProgress(page, second)).additional.completion).toBeNull()
  await page.unroute('**/api/profile/tutorial/progress')
  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ', exact: true }).click()
  await logout(page)
  await login(page, first)
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true })).toBeVisible()
  let release!: () => void
  let received!: (progress: TutorialLessonsProgress) => void
  let settled!: () => void
  const releaseResponse = new Promise<void>((resolve) => { release = resolve })
  const heldResponse = new Promise<TutorialLessonsProgress>((resolve) => { received = resolve })
  const delivered = new Promise<void>((resolve) => { settled = resolve })
  await page.route('**/api/profile/tutorial/progress', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    received(await response.json() as TutorialLessonsProgress)
    await releaseResponse
    try { await route.fulfill({ response }) } finally { settled() }
  })
  let progress: TutorialLessonsProgress
  try {
    await openLessonFromMenu(page, 'additional')
    progress = await heldResponse
    expect(progress.base).toEqual({ legacyCredit: null, completion: null })
    expect(progress.additional.completion).toMatchObject({ scenarioVersion: 'additional-standard-v1' })
    await expect(page.getByText('Сохраняем результат обучения', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ', exact: true }).click()
    await logout(page)
    await login(page, second)
    await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true })).toBeVisible()
    await openLessonFromMenu(page, 'additional')
    await expect(page.getByRole('button', { name: 'Начать дополнительный урок', exact: true })).toBeVisible()
    release()
    await delivered
    await expect(page.getByRole('button', { name: 'Начать дополнительный урок', exact: true })).toBeVisible()
    expect((await readProgress(page, second)).additional.completion).toBeNull()
  } finally { release(); await page.unroute('**/api/profile/tutorial/progress') }
  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ', exact: true }).click()
  await logout(page)
  await login(page, first)
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true })).toBeVisible()
  expect(await readProgress(page, first)).toEqual(progress)
})

test('guest additional completion survives a failed account save and reload before a real retry', async ({ page }) => {
  const account = await registerAccount(page, 'additional-retry')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
  await playAdditionalTutorial(page)
  await page.getByRole('link', { name: 'Уже есть аккаунт', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toHaveAttribute('aria-selected', 'true')
  let rejected = 0
  await page.route('**/api/profile/tutorial/progress', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    expect(route.request().postDataJSON()).toEqual({ kind: 'scenario-completed', lessonId: 'additional', scenarioVersion: 'additional-standard-v1' })
    rejected += 1
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Temporary failure' } }) })
  })
  await login(page, account)
  await expect(page).toHaveURL('/tutorial?lesson=additional')
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  expect((await readProgress(page, account)).additional.completion).toBeNull()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Сохранить отметку', exact: true })).toBeEnabled()
  expect(rejected).toBeGreaterThanOrEqual(2)
  await page.unroute('**/api/profile/tutorial/progress')
  const saved = additionalSaved(page)
  await page.getByRole('button', { name: 'Сохранить отметку', exact: true }).click()
  const progress = await (await saved).json() as TutorialLessonsProgress
  expect(progress.base).toEqual({ legacyCredit: null, completion: null })
  expect(progress.additional.completion).toMatchObject({ origin: 'scenario', scenarioVersion: 'additional-standard-v1' })
  await expect(page.getByText('Дополнительное обучение завершено', { exact: true })).toBeVisible()
  expect(await readProgress(page, account)).toEqual(progress)
})
