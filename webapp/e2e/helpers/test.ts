import { expect, type Page } from '@playwright/test'

export { expect, test } from '@playwright/test'

export const e2ePassword = 'password123'
const e2eClientIpSuffixByWorkerIndex = new Map<number, number>()
const maximumE2eWorkerIndex = 511
const maximumE2eClientIpSuffix = 254

export function nextE2eClientIp() {
  const workerIndex = readWorkerIndex()
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex > maximumE2eWorkerIndex) {
    throw new RangeError(
      `E2E worker index must be an integer from 0 through ${maximumE2eWorkerIndex}`,
    )
  }

  const suffix = (e2eClientIpSuffixByWorkerIndex.get(workerIndex) ?? 0) + 1
  if (suffix > maximumE2eClientIpSuffix) {
    throw new RangeError(`E2E worker ${workerIndex} exhausted its synthetic client IP pool`)
  }
  e2eClientIpSuffixByWorkerIndex.set(workerIndex, suffix)

  const secondOctet = 18 + Math.floor(workerIndex / 256)
  const thirdOctet = workerIndex % 256
  return `198.${secondOctet}.${thirdOctet}.${suffix}`
}

function readWorkerIndex() {
  const value = process.env.TEST_WORKER_INDEX ?? process.env.TEST_PARALLEL_INDEX ?? '0'
  if (!/^\d+$/.test(value)) {
    throw new RangeError(
      `E2E worker index must be an integer from 0 through ${maximumE2eWorkerIndex}`,
    )
  }
  return Number(value)
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
  await page.getByRole('checkbox', { name: 'Я принимаю Пользовательское соглашение' }).check()
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
