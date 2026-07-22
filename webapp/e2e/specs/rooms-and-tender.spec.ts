import { expect, registerBrowserUser, test } from '../helpers/test'

test('two players create a room, start a Tender, and receive the next phase', async ({ browser, page }) => {
  await registerBrowserUser(page, 'Хост E2E', 'room-host')
  const webOrigin = new URL(page.url()).origin

  const guestContext = await browser.newContext({ baseURL: webOrigin })
  const guestPage = await guestContext.newPage()
  try {
    await registerBrowserUser(guestPage, 'Гость E2E', 'room-guest', webOrigin)

    await page.getByRole('link', { name: 'Комнаты' }).click()
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)

    const roomId = new URL(page.url()).pathname.split('/').at(-1)
    if (!roomId) throw new Error('Room identifier is missing from the lobby URL')

    await guestPage.getByRole('link', { name: 'Комнаты' }).click()
    await guestPage.getByLabel('ID комнаты').fill(roomId)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await expect(guestPage.getByText('2/2 участников')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать Тендер' })).toBeEnabled()

    await page.getByRole('button', { name: 'Начать Тендер' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(guestPage).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: '1. Выбор слота доступа' })).toBeVisible()
    await expect(guestPage.getByRole('heading', { name: '1. Выбор слота доступа' })).toBeVisible()

    await page.getByRole('button', { name: 'Слот доступа 1: Emergency' }).click()
    await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
    await guestPage.getByRole('button', { name: 'Слот доступа 2: Priority' }).click()
    await guestPage.getByRole('button', { name: 'Подтвердить выбор' }).click()

    await expect(page.getByRole('heading', { name: '2. Распределение мощности' })).toBeVisible()
    await expect(guestPage.getByRole('heading', { name: '2. Распределение мощности' })).toBeVisible()
  } finally {
    await guestContext.close()
  }
})
