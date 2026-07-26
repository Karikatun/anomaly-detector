import { expect, type Page } from '@playwright/test'

export { expect, test } from '@playwright/test'

export const e2ePassword = 'password123'

export function uniqueLogin(prefix = 'web-e2e') {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '')
  const suffix = Math.random().toString(36).slice(2, 8)

  return `${prefix}-${timestamp}-${suffix}`
}

export async function registerBrowserUser(
  page: Page,
  displayName: string,
  prefix = 'web-e2e',
  startUrl = '/',
) {
  const login = uniqueLogin(prefix)
  await page.goto(startUrl)
  await page.getByRole('button', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill(displayName)
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я согласен на обработку персональных данных' }).check()
  await page.getByRole('button', { name: 'Регистрация' }).click()
  await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeVisible()
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(
        (cookie) => cookie.name === 'anomaly_detector_refresh' && cookie.httpOnly,
      ),
    )
    .toBe(true)
  return { login }
}
