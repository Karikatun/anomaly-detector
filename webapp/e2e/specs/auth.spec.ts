import { e2ePassword, expect, registerBrowserUser, test } from '../helpers/test'

test('registers, restores the browser session, opens the profile, and logs out', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Пользователь E2E', 'auth')

  await page.reload()
  await expect(page.getByRole('link', { name: 'Комнаты' })).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'anomaly_detector_refresh' && cookie.httpOnly,
      ),
    )
    .toBe(true)

  await page.getByRole('link', { name: 'Мои матчи' }).click()
  await expect(page.getByRole('heading', { name: 'Пользователь E2E' })).toBeVisible()
  await expect(page.getByText(login)).toBeVisible()

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('link', { name: 'Комнаты' })).toBeVisible()
})

test('uses the configured API transport when OAuth is unavailable', async ({ page }) => {
  await page.goto('/')

  const oauthButton = page.getByRole('button', { name: 'Яндекс ID' })
  await oauthButton.click()

  await expect(page.getByText('Ошибка сервера. Попробуйте позже.')).toBeVisible()
  await expect(page.getByText('Не удалось связаться с сервером. OAuth работает только с localhost.')).toHaveCount(0)
})

test('opens the Rules Reference from the authenticated home page', async ({ page }) => {
  await registerBrowserUser(page, 'Правила E2E', 'rules-home')

  await expect(page.getByRole('heading', { name: 'Добро пожаловать, Правила E2E' })).toBeVisible()
  await page.getByRole('button', { name: 'Правила' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Справочник правил' })).toBeVisible()
  await expect(page.getByText('Final Contract и финальная модель')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть правила' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})
