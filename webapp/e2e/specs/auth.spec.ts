import { e2ePassword, expect, registerBrowserUser, test } from '../helpers/test'

test('requires explicit privacy consent and age confirmation before registration', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await page.getByLabel('Имя').fill('Осознанный пользователь')
  await page.getByLabel('Логин').fill('explicit-consent')
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)

  const submit = page.getByRole('button', { name: 'Регистрация', exact: true })
  const privacyConsent = page.getByRole('checkbox', { name: 'Я согласен на обработку персональных данных' })
  const ageConfirmation = page.getByRole('checkbox', { name: 'Мне исполнилось 18 лет' })

  await expect(submit).toBeDisabled()
  await privacyConsent.check()
  await expect(submit).toBeDisabled()
  await ageConfirmation.check()
  await expect(submit).toBeEnabled()
})

test('shows and hides the password in login and registration modes', async ({ page }) => {
  await page.goto('/')

  const password = page.locator('#auth-password')
  await expect(password).toHaveAttribute('type', 'password')

  await page.getByRole('button', { name: 'Показать пароль' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Скрыть пароль' }).click()
  await expect(password).toHaveAttribute('type', 'password')

  await page.getByRole('button', { name: 'Регистрация', exact: true }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Показать пароль' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Скрыть пароль' }).click()
  await expect(password).toHaveAttribute('type', 'password')
})

test('registers, restores the browser session, opens the profile, and logs out', async ({ page }) => {
  const { login } = await registerBrowserUser(page, 'Пользователь E2E', 'auth')

  await page.reload()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'anomaly_detector_refresh' && cookie.httpOnly,
      ),
    )
    .toBe(true)

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(page.getByRole('heading', { name: 'Пользователь E2E' })).toBeVisible()
  await expect(page.getByText(login)).toBeVisible()

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
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

  await expect(page.getByText('Правила E2E', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Правила' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Справочник правил' })).toBeVisible()
  await expect(page.getByText('Финальный контракт и финальная модель')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть правила' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
})
