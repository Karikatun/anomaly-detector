import { e2ePassword, expect, registerBrowserUser, test } from '../helpers/test'

test('registers, restores the browser session, opens the profile, and logs out', async ({ page }) => {
  const { email } = await registerBrowserUser(page, 'Пользователь E2E', 'auth')

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
  await expect(page.getByText(email)).toBeVisible()

  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(e2ePassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('link', { name: 'Комнаты' })).toBeVisible()
})
