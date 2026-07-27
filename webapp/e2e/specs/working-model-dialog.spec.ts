import type { Page } from '@playwright/test'

import { expect, registerBrowserUser, test } from '../helpers/test'

async function chooseAccessSlot(page: Page, slot: number) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
}

async function allocateReconnaissance(page: Page) {
  await page.getByRole('button', { name: 'Увеличить мощность: Разведка' }).click()
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
}

async function expectDialogInsideViewport(page: Page) {
  const viewport = page.viewportSize()
  const stickyHeader = page.locator('header[aria-label="Текущая фаза игры"]')
  const dialog = page.getByRole('dialog')
  const closeButton = dialog.locator('[data-slot="dialog-close"]')
  const [headerBox, dialogBox, closeButtonBox] = await Promise.all([
    stickyHeader.boundingBox(),
    dialog.boundingBox(),
    closeButton.boundingBox(),
  ])

  expect(viewport).not.toBeNull()
  expect(headerBox).not.toBeNull()
  expect(dialogBox).not.toBeNull()
  expect(closeButtonBox).not.toBeNull()
  expect(dialogBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width)
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height)

  const hitTargetIsCloseButton = await closeButton.evaluate((button, box) => {
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return target === button || button.contains(target)
  }, closeButtonBox!)
  expect(hitTargetIsCloseButton).toBe(true)

  await closeButton.click()
  await expect(dialog).toBeHidden()
}

test('keeps the Working Model dialog below the Tender header and inside the viewport', async ({
  browser,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await registerBrowserUser(page, 'Хост модалки', 'working-model-host')
  const webOrigin = new URL(page.url()).origin
  const guestContext = await browser.newContext({
    baseURL: webOrigin,
    viewport: { width: 390, height: 844 },
  })
  const guestPage = await guestContext.newPage()

  try {
    await registerBrowserUser(guestPage, 'Гость модалки', 'working-model-guest', webOrigin)
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)
    const roomId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
    if (!roomId) throw new Error('Room identifier is missing')

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('ID комнаты').fill(roomId)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Начать игру' }).click()

    await chooseAccessSlot(page, 1)
    await chooseAccessSlot(guestPage, 2)
    await allocateReconnaissance(page)
    await allocateReconnaissance(guestPage)

    await expect(page.getByRole('heading', { name: '3. Разведка' })).toBeVisible()
    await page.getByRole('button', { name: /Рабочая модель/ }).click()
    await expectDialogInsideViewport(page)

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('button', { name: /Рабочая модель/ }).click()
    await expectDialogInsideViewport(page)
  } finally {
    await guestContext.close()
  }
})
