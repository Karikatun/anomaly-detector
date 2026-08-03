import { expect, type Page } from '@playwright/test'

export { expect, test } from '@playwright/test'

export const e2ePassword = 'password123'
let e2eClientIpSuffix = 1

function nextE2eClientIp() {
  const suffix = e2eClientIpSuffix
  e2eClientIpSuffix += 1
  const thirdOctet = Math.floor((suffix - 1) / 254)
  const fourthOctet = ((suffix - 1) % 254) + 1
  return `198.18.${thirdOctet}.${fourthOctet}`
}

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
  await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': nextE2eClientIp() })
  await page.goto(startUrl)
  await page.getByRole('tab', { name: 'Регистрация' }).click()
  await page.getByLabel('Имя').fill(displayName)
  await page.getByLabel('Логин').fill(login)
  await page.getByLabel('Пароль', { exact: true }).fill(e2ePassword)
  await page.getByRole('checkbox', { name: 'Я даю согласие на обработку персональных данных' }).check()
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
