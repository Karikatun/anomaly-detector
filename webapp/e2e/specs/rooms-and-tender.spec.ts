import type { Page } from '@playwright/test'

import { expect, registerBrowserUser, test } from '../helpers/test'

const headings = {
  access: '1. Выбор слота доступа',
  power: '2. Распределение мощности',
  reconnaissance: '3. Разведка',
  laboratory: '4. Лаборатория',
  analysis: '5. Анализ модели',
  contracts: '6. Контракты',
  final: '7. Финальная научная модель',
} as const

async function expectPhase(page: Page, heading: string) {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
}

async function expectSynchronizedTimers(first: Page, second: Page) {
  const firstTimer = first.getByRole('timer', { name: 'До конца фазы' })
  const secondTimer = second.getByRole('timer', { name: 'До конца фазы' })
  await expect(firstTimer).toBeVisible()
  await expect(secondTimer).toBeVisible()
  await expect.poll(async () => {
    const toSeconds = (value: string | null) => {
      const [minutes = 0, seconds = 0] = (value ?? '').split(':').map(Number)
      return minutes * 60 + seconds
    }
    return Math.abs(toSeconds(await firstTimer.textContent()) - toSeconds(await secondTimer.textContent()))
  }).toBeLessThanOrEqual(1)
}

async function chooseAccessSlot(page: Page, slot: number) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
}

async function allocatePower(page: Page, allocation: Record<string, number>) {
  for (const [category, amount] of Object.entries(allocation)) {
    for (let value = 0; value < amount; value += 1) {
      await page.getByRole('button', { name: `Увеличить мощность: ${category}` }).click()
    }
  }
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
}

async function runReconnaissance(page: Page, signalCount = 2) {
  const targets = page.getByRole('button', { name: /^Сигнал для разведки:/ })
  for (let index = 0; index < signalCount; index += 1) {
    await targets.nth(index).click()
  }
  await page.getByRole('button', { name: 'Исследовать' }).click()
}

async function runLaboratory(page: Page) {
  await page.getByRole('button', { name: /^Источник:/ }).first().click()
  await page.getByRole('button', { name: /^Приёмник:/ }).first().click()
  await page.getByRole('button', { name: 'Провести опыт' }).click()
}

async function submitThesis(page: Page) {
  const submit = page.getByRole('button', { name: 'Выдвинуть тезис' })
  await page.getByRole('combobox', { name: 'Сигнал для тезиса' }).selectOption('aster')
  await page.getByRole('combobox', { name: 'Тип поля для тезиса' }).selectOption('inertial')
  await page.getByRole('combobox', { name: 'Полярность для тезиса' }).selectOption('positive')
  await expect(submit).toBeEnabled()
  const commandResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/tenders/') && response.url().endsWith('/commands'))
  await submit.click()
  expect((await commandResponse).ok()).toBe(true)
}

async function completeContract(page: Page) {
  const reserve = page
    .locator('[data-contract-kind="complex"], [data-contract-kind="light"]')
    .getByRole('button', { name: /^Зарезервировать контракт / })
    .first()
  const contractId = (await reserve.getAttribute('aria-label'))?.replace('Зарезервировать контракт ', '')
  if (!contractId) throw new Error('Contract identifier is missing')

  await reserve.click()
  await expect(page.getByText('Зафиксирован · доказательства справа')).toBeVisible()
  await page.locator('button[data-evidence]:not(:disabled)').first().click()
  const submit = page.getByRole('button', { name: /^Подать заявку по контракту / })
  await submit.click()
}

async function submitFinalModel(page: Page) {
  await page.getByRole('button', { name: 'Aster: тип поля Инерционное', exact: true }).click()
  await page.getByRole('button', { name: 'Aster: полярность Положительная', exact: true }).click()
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
}

test('restores the authenticated lobby before joining again after a direct reload', async ({ page }) => {
  await registerBrowserUser(page, 'Хост перезагрузки E2E', 'reload-lobby-host')
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await page.getByLabel('Количество игроков').selectOption('2')
  await page.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)

  await page.route('**/api/auth/refresh', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.continue()
  })
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Лобби' })).toBeVisible()
  await expect(page.getByText('Комната не найдена')).toBeHidden()
})

test('requires every lobby player to be ready before enabling the match start', async ({ browser, page }) => {
  let hostJoinRequests = 0
  let hostRoomReads = 0
  page.on('request', (request) => {
    if (/\/api\/rooms\/[0-9a-f-]+\/join$/.test(request.url())) hostJoinRequests += 1
    if (/\/api\/rooms\/[0-9a-f-]+$/.test(request.url()) && request.method() === 'GET') hostRoomReads += 1
  })
  await registerBrowserUser(page, 'Хост готовности E2E', 'ready-host')
  const webOrigin = new URL(page.url()).origin
  const guestContext = await browser.newContext({ baseURL: webOrigin })
  const guestPage = await guestContext.newPage()

  try {
    await registerBrowserUser(guestPage, 'Гость готовности E2E', 'ready-guest', webOrigin)
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
    const roomId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
    if (!roomId) throw new Error('Room identifier is missing from the lobby URL')

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('ID комнаты').fill(roomId)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await expect.poll(() => hostRoomReads).toBeGreaterThan(0)
    expect(hostJoinRequests).toBe(0)
    await page.route('**/api/rooms/*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Комната временно недоступна' } }),
        })
        return
      }
      await route.continue()
    })
    await expect(page.getByRole('alert')).toContainText('Показаны последние полученные данные')
    await page.unroute('**/api/rooms/*')
    await page.getByRole('button', { name: 'Повторить обновление' }).click()
    await expect(page.getByText('Показаны последние полученные данные')).toBeHidden()

    const startButton = page.getByRole('button', { name: 'Начать игру' })
    await expect(startButton).toBeDisabled()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByText('Готовы: 1/2')).toBeVisible()
    let rejectReady = true
    await page.route('**/api/rooms/*/ready', async (route) => {
      if (rejectReady) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Готовность временно недоступна' } }),
        })
        return
      }
      await route.continue()
    })
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Готовность временно недоступна')
    rejectReady = false
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByText('Готовность временно недоступна')).toBeHidden()
    await expect(startButton).toBeEnabled()
    let rejectStart = true
    await page.route('**/api/rooms/*/start', async (route) => {
      if (rejectStart) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Старт временно недоступен' } }),
        })
        return
      }
      await route.continue()
    })
    await startButton.click()
    await expect(page.getByRole('alert')).toContainText('Старт временно недоступен')
    rejectStart = false
    await guestPage.evaluate(() => {
      const browserNow = Date.now.bind(Date)
      Date.now = () => browserNow() + 5 * 60_000
    })
    await startButton.click()
    await expect(page.getByText('Старт временно недоступен')).toBeHidden()
    await expect(page.getByText('Старт через 5 сек.')).toBeVisible()
    await expect(guestPage.getByText(/Старт через [4-5] сек\./)).toBeVisible()
    await page.getByRole('button', { name: 'Отменить старт' }).click()
  } finally {
    await guestContext.close()
  }
})

test('opens the Rules Reference inside an active Tender without leaving it', async ({ browser, page }) => {
  await registerBrowserUser(page, 'Хост правил E2E', 'rules-tender-host')
  const webOrigin = new URL(page.url()).origin
  const guestContext = await browser.newContext({ baseURL: webOrigin })
  const guestPage = await guestContext.newPage()
  try {
    await registerBrowserUser(guestPage, 'Гость правил E2E', 'rules-tender-guest', webOrigin)
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
    const roomId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
    if (!roomId) throw new Error('Room identifier is missing from the lobby URL')

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await expect(guestPage.getByRole('dialog')).toBeVisible()
    await guestPage.getByLabel('ID комнаты').fill(roomId)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeDisabled()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByText('Готовы: 1/2')).toBeVisible()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)

    await page.getByRole('button', { name: 'Правила' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Контракты и доказательства')).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expectPhase(page, headings.access)
  } finally {
    await guestContext.close()
  }
})

test('two players complete every Tender stage and receive each realtime phase transition', async ({ browser, page }) => {
  test.setTimeout(180_000)
  await registerBrowserUser(page, 'Хост E2E', 'room-host')
  const webOrigin = new URL(page.url()).origin

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(
    page.getByText('Сыграно матчей').locator('..').getByText('0', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()

  const guestContext = await browser.newContext({ baseURL: webOrigin })
  const guestPage = await guestContext.newPage()
  try {
    await registerBrowserUser(guestPage, 'Гость E2E', 'room-guest', webOrigin)

    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)

    const roomId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
    if (!roomId) throw new Error('Room identifier is missing from the lobby URL')

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await expect(guestPage.getByRole('dialog')).toBeVisible()
    await guestPage.getByLabel('ID комнаты').fill(roomId)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await expect(guestPage.getByText('Готовы: 0/2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeDisabled()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByText('Готовы: 1/2')).toBeVisible()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()

    await guestPage.evaluate(() => {
      const browserNow = Date.now.bind(Date)
      Date.now = () => browserNow() - 7 * 60_000
    })
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(guestPage).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('button', { name: 'Выйти из матча' })).toBeVisible()
    await page.getByRole('button', { name: 'Правила' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Контракты и доказательства')).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'МОИ МАТЧИ' })).toBeHidden()
    await expectPhase(page, headings.access)
    await expectPhase(guestPage, headings.access)
    await expectSynchronizedTimers(page, guestPage)
    await expect(page.getByText('Хост E2E → Гость E2E', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', {
      name: 'Слот доступа 5: Ночной. Порядок действия: 5. Компенсация: 1 образец сигнала',
    })).toBeVisible()
    await expect(page.getByRole('button', {
      name: 'Слот доступа 6: Удалённый. Порядок действия: 6. Компенсация: 1 бюджет и 1 образец сигнала',
    })).toBeVisible()

    let rejectFirstCommand = true
    await page.route('**/api/tenders/*/commands', async (route) => {
      if (rejectFirstCommand) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Команда временно недоступна' } }),
        })
        return
      }
      await route.continue()
    })
    await page.getByRole('button', { name: /^Слот доступа 1:/ }).click()
    await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
    await expect(page.getByRole('alert')).toContainText('Команда временно недоступна')
    await expect(page.getByRole('button', { name: 'Подтвердить выбор' })).toBeEnabled()
    rejectFirstCommand = false
    await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
    await expect(page.getByRole('button', { name: 'Выбор принят — ожидаем игроков' })).toBeDisabled()
    await expect(page.getByRole('status')).toContainText('Слот 1: Аварийный зафиксирован и остаётся секретным.')
    await expectPhase(guestPage, headings.access)
    await chooseAccessSlot(guestPage, 2)

    await expectPhase(page, headings.power)
    await expectPhase(guestPage, headings.power)
    await expectSynchronizedTimers(page, guestPage)
    await expect(page.getByText('2: непрерывный опыт с публичным результатом и приватным измерением полярности.')).toBeVisible()
    await expect(page.getByText('1: зарезервируйте и подайте одну заявку по контракту.')).toBeVisible()
    await expect(page.getByText('Слот 1', { exact: true })).toBeVisible()
    await allocatePower(page, { 'Разведка': 2, 'Лаборатория': 1, 'Контракты': 1 })
    await allocatePower(guestPage, { 'Разведка': 2, 'Лаборатория': 1, 'Контракты': 1 })

    await expectPhase(page, headings.reconnaissance)
    await runReconnaissance(page)
    await expectPhase(guestPage, headings.reconnaissance)
    await runReconnaissance(guestPage)

    await expectPhase(page, headings.laboratory)
    await runLaboratory(page)
    await expectPhase(guestPage, headings.laboratory)
    await runLaboratory(guestPage)

    await expectPhase(page, headings.contracts)
    await completeContract(page)
    await expectPhase(guestPage, headings.contracts)
    await completeContract(guestPage)

    for (let round = 2; round <= 5; round += 1) {
      await expectPhase(page, headings.access)
      await expectPhase(guestPage, headings.access)
      await expectSynchronizedTimers(page, guestPage)
      await chooseAccessSlot(page, 1)
      await chooseAccessSlot(guestPage, 2)

      await expectPhase(page, headings.power)
      await expectPhase(guestPage, headings.power)
      await allocatePower(page, { 'Разведка': 1, 'Лаборатория': 2, 'Анализ модели': 1 })
      await allocatePower(guestPage, { 'Разведка': 1, 'Лаборатория': 2, 'Анализ модели': 1 })

      await expectPhase(page, headings.reconnaissance)
      await runReconnaissance(page, 1)
      await expectPhase(guestPage, headings.reconnaissance)
      await runReconnaissance(guestPage, 1)

      await expectPhase(page, headings.laboratory)
      await expectPhase(guestPage, headings.laboratory)
      await runLaboratory(page)
      await runLaboratory(guestPage)

      await expectPhase(page, headings.analysis)
      await expectPhase(guestPage, headings.analysis)
      await submitThesis(page)
      await submitThesis(guestPage)
    }

    await expectPhase(page, headings.final)
    await expectPhase(guestPage, headings.final)
    await submitFinalModel(page)
    await expectPhase(guestPage, headings.final)
    await submitFinalModel(guestPage)
    await expect(page.getByText('Тендер завершён', { exact: true })).toBeVisible()
    await expect(guestPage.getByText('Тендер завершён', { exact: true })).toBeVisible()
    await expect(page.getByText('Итоговый рейтинг', { exact: true })).toBeVisible()
    await expect(page.getByText('Хост E2E', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/(Инерционное|Электромагнитное|Фазовое) \/ (Положительная|Отрицательная)/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Выйти из матча' }).click()
    await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
    await expect(
      page.getByText('Сыграно матчей').locator('..').getByText('1', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Завершите первый матч, чтобы появилась статистика.')).toHaveCount(0)
  } finally {
    await guestContext.close()
  }
})
