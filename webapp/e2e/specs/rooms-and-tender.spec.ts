import type { Page } from '@playwright/test'

import { expect, registerBrowserUser, test } from '../helpers/test'

const headings = {
  access: '1. Выбор слота доступа',
  power: '2. Распределение мощности',
  reconnaissance: '3. Разведка',
  laboratory: '4. Лаборатория',
  analysis: '5. Анализ модели',
  contracts: '6. Контракты',
  final: '7. Финальная модель',
} as const

async function expectPhase(page: Page, heading: string) {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
}

async function readRoomJoinCode(page: Page) {
  const code = (await page.getByTestId('room-join-code').textContent())?.trim()
  if (!code) throw new Error('Room join code is missing from the lobby')
  return code
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
  const deepMode = page.getByRole('button', { name: 'Глубокое', exact: true })
  if (await deepMode.isVisible()) await deepMode.click()

  await page.getByRole('button', { name: /^Образец:/ }).first().click()
  await expect(page.getByRole('button', { name: /^Источник:/ })).toHaveCount(1)

  await page.getByRole('button', { name: /^Источник:/ }).click()
  await expect(page.getByRole('button', { name: /^Источник:/ })).toHaveCount(0)

  await page.getByRole('button', { name: /^Образец:/ }).first().click()
  await page.getByRole('button', { name: /^Образец:/ }).first().click()
  await expect(page.getByRole('button', { name: /^Приёмник:/ })).toHaveCount(1)

  await page.getByRole('button', { name: /^Провести опыт:/ }).click()
}

async function verifyWorkingModelModal(page: Page) {
  const pageErrors: Error[] = []
  const collectPageError = (error: Error) => pageErrors.push(error)
  page.on('pageerror', collectPageError)
  await page.setViewportSize({ width: 390, height: 844 })
  try {
    const stickyHeader = page.locator('header[aria-label="Текущая фаза игры"]')
    const sharedTimer = stickyHeader.locator('[role="timer"]')
    await expect(sharedTimer).toBeVisible()
    const initialTime = await sharedTimer.textContent()

    await page.getByRole('button', { name: 'Трактовка анализов' }).click()
    const laboratoryDialog = page.getByRole('dialog')
    const laboratoryWarning = laboratoryDialog.getByRole('status')
    const laboratoryCopy = laboratoryDialog.getByText('Источник и приёмник нельзя менять местами при трактовке результата.')
    const laboratoryClose = laboratoryDialog.getByRole('button', { name: 'Закрыть трактовку анализов' })
    const [warningBox, copyBox, closeBox] = await Promise.all([
      laboratoryWarning.boundingBox(),
      laboratoryCopy.boundingBox(),
      laboratoryClose.boundingBox(),
    ])
    expect(warningBox).not.toBeNull()
    expect(copyBox).not.toBeNull()
    expect(closeBox).not.toBeNull()
    expect(warningBox!.y + warningBox!.height).toBeLessThanOrEqual(copyBox!.y)
    expect(await laboratoryClose.evaluate((button, box) => {
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return target === button || button.contains(target)
    }, closeBox!)).toBe(true)
    await laboratoryClose.click()
    await expect(laboratoryDialog).toBeHidden()

    await page.getByRole('button', { name: /Рабочая модель/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await expect(sharedTimer).toBeVisible()
    await expect(dialog.locator('[role="timer"]')).toHaveCount(0)
    await expect.poll(() => sharedTimer.textContent()).not.toBe(initialTime)

    const headerBox = await stickyHeader.boundingBox()
    const dialogBox = await dialog.boundingBox()
    expect(headerBox).not.toBeNull()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)

    const fieldButton = dialog.getByRole('button', {
      name: 'Aster: гипотеза, тип поля Инерционное',
    })
    await expect(fieldButton).toBeEnabled()
    await fieldButton.click()
    await expect(fieldButton).toHaveAttribute('aria-pressed', 'true')
    await fieldButton.click()
    await expect(fieldButton).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.route('**/api/tenders/*/commands', async (route) => {
      const command = route.request().postDataJSON() as { type?: string } | null
      if (command?.type === 'update-working-model') {
        await new Promise((resolve) => setTimeout(resolve, 600))
      }
      await route.continue()
    })
    const inlineTable = page.getByTestId('working-model-table')
    const inlinePanel = inlineTable.locator('..')
    const inlineBefore = await inlineTable.boundingBox()
    expect(inlineBefore).not.toBeNull()
    await inlinePanel.getByRole('button', {
      name: 'Aster: гипотеза, полярность Положительная',
    }).click()
    await expect(inlinePanel.getByRole('status')).toHaveText('Сохраняем рабочую модель…')
    const inlineDuring = await inlineTable.boundingBox()
    expect(inlineDuring).not.toBeNull()
    expect(inlineDuring!.y).toBe(inlineBefore!.y)
    expect(inlineDuring!.height).toBe(inlineBefore!.height)
    await expect(inlinePanel.getByRole('status')).toBeHidden()
    await page.unrouteAll({ behavior: 'wait' })
    expect(pageErrors).toEqual([])
  } finally {
    page.off('pageerror', collectPageError)
    await page.setViewportSize({ width: 1280, height: 720 })
  }
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
  const skip = page.getByRole('button', { name: 'Пропустить ход' })
  const confirm = page.getByRole('button', { name: /^Подтвердить контракт / }).first()
  await expect.poll(async () => await confirm.isVisible() || await skip.isEnabled()).toBe(true)
  if (!await confirm.isVisible()) {
    await skip.click()
    return
  }

  const contractCard = confirm.locator('xpath=ancestor::article')
  const contractId = await contractCard.getAttribute('data-contract-id')
  if (!contractId) throw new Error('Eligible Contract card has no stable id')
  const selectedContractCard = page.locator(`article[data-contract-id="${contractId}"]`)
  const fittingEvidence = contractCard.getByRole('combobox', { name: /Подходящее исследование|Подходящая сертификация/ })
  await expect(fittingEvidence).toBeEnabled()
  await fittingEvidence.selectOption({ index: 1 })
  const additionalEvidence = contractCard.getByRole('combobox', { name: 'Дополнительное исследование' })
  if (await additionalEvidence.isVisible() && await additionalEvidence.isEnabled()) {
    await additionalEvidence.selectOption({ index: 1 })
  }
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(selectedContractCard.getByText('Контракт выполнен', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Подтвердить контракт / })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Подходящее исследование|Подходящая сертификация|Дополнительное исследование/ })).toHaveCount(0)
}

async function submitFinalModel(page: Page) {
  await page.getByRole('button', { name: 'Ferro: тип поля Инерционное', exact: true }).click()
  await page.getByRole('button', { name: 'Ferro: полярность Положительная', exact: true }).click()
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
  const copyRoomId = page.getByRole('button', { name: /Скопировать ID комнаты/ })
  await expect(page.getByText('ID:', { exact: true })).toBeVisible()
  await expect(page.getByTestId('room-copy-icon')).toBeVisible()
  await copyRoomId.click()
  await expect(page.getByTestId('room-copy-success')).toBeVisible()
  await expect(page.getByTestId('room-copy-icon')).toHaveCount(0)
  await expect(page.getByTestId('room-copy-success')).toHaveCount(0, { timeout: 2_500 })
  await expect(page.getByTestId('room-copy-icon')).toBeVisible()
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
    const roomJoinCode = await readRoomJoinCode(page)

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('Код комнаты').fill(roomJoinCode)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    for (const lobbyPage of [page, guestPage]) {
      await expect(lobbyPage.getByText('Хост готовности E2E', { exact: true })).toBeVisible()
      await expect(lobbyPage.getByText('Гость готовности E2E', { exact: true })).toBeVisible()
      await expect(lobbyPage.getByText(/^Игрок \d+$/)).toHaveCount(0)
    }
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

test('lets a player collapse and return, then permanently forfeit the match', async ({ browser, page }) => {
  test.setTimeout(60_000)
  await registerBrowserUser(page, 'Хост выхода E2E', 'leave-host')
  const webOrigin = new URL(page.url()).origin
  const guestContext = await browser.newContext({ baseURL: webOrigin })
  const guestPage = await guestContext.newPage()

  try {
    await registerBrowserUser(guestPage, 'Гость выхода E2E', 'leave-guest', webOrigin)
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)
    const roomJoinCode = await readRoomJoinCode(page)

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('Код комнаты').fill(roomJoinCode)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(guestPage).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)

    const headerTimer = page
      .locator('header[aria-label="Текущая фаза игры"]')
      .locator('[role="timer"]')
    const toSeconds = (value: string | null) => {
      const [minutes = 0, seconds = 0] = (value ?? '').split(':').map(Number)
      return minutes * 60 + seconds
    }
    const initialHeaderSeconds = toSeconds(await headerTimer.textContent())
    await expect.poll(async () =>
      initialHeaderSeconds - toSeconds(await headerTimer.textContent()),
    ).toBeGreaterThanOrEqual(2)
    await page.getByRole('button', { name: 'Выйти из матча' }).click()
    const exitDialog = page.getByRole('dialog', { name: 'Что сделать с матчем?' })
    const exitTimer = exitDialog.getByRole('timer', { name: 'До конца фазы' })
    await expect.poll(async () => {
      return Math.abs(toSeconds(await headerTimer.textContent()) - toSeconds(await exitTimer.textContent()))
    }, { timeout: 3_000 }).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Свернуть', exact: true }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('button', { name: 'ВЕРНУТЬСЯ В МАТЧ' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeHidden()

    await page.getByRole('button', { name: 'ИСТОРИЯ МАТЧЕЙ' }).click()
    await expect(page.getByText('Активен', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Детали' }).click()
    await expect(page).toHaveURL((url) =>
      /^\/tenders\/[0-9a-f-]{36}$/.test(url.pathname)
      && url.searchParams.get('from') === 'matches')
    await expect(page.getByRole('heading', { name: headings.access })).toBeVisible()

    await page.getByRole('button', { name: 'Выйти из матча' }).click()
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(page).toHaveURL('/')
    await expect(guestPage.getByRole('heading', { name: 'Тендер завершён' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ВЕРНУТЬСЯ В МАТЧ' })).toBeHidden()

    await page.getByRole('button', { name: 'ИСТОРИЯ МАТЧЕЙ' }).click()
    await expect(page.getByText('Вы выбыли', { exact: true })).toBeVisible()
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
    const roomJoinCode = await readRoomJoinCode(page)

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await expect(guestPage.getByRole('dialog')).toBeVisible()
    await guestPage.getByLabel('Код комнаты').fill(roomJoinCode)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeDisabled()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByText('Готовы: 1/2')).toBeVisible()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)

    await page.setViewportSize({ width: 390, height: 844 })
    const tenderHeader = page.locator('header[aria-label="Текущая фаза игры"]')
    const leaveButton = page.getByRole('button', { name: 'Выйти из матча' })
    const rulesButton = page.getByRole('button', { name: 'Правила' })
    const laboratoryButton = page.getByRole('button', { name: 'Трактовка анализов' })
    const [leaveBox, rulesBox, laboratoryBox] = await Promise.all([
      leaveButton.boundingBox(),
      rulesButton.boundingBox(),
      laboratoryButton.boundingBox(),
    ])
    expect(leaveBox).not.toBeNull()
    expect(rulesBox).not.toBeNull()
    expect(laboratoryBox).not.toBeNull()
    expect(leaveBox!.y).toBeLessThan(rulesBox!.y)
    expect(leaveBox!.y).toBeLessThan(laboratoryBox!.y)
    expect(await tenderHeader.evaluate((header) => header.scrollWidth <= header.clientWidth)).toBe(true)

    await page.getByRole('button', { name: 'Правила' }).click()
    const rulesDialog = page.getByRole('dialog')
    await expect(rulesDialog).toBeVisible()
    const timerWarning = rulesDialog.getByRole('status')
    const firstRule = rulesDialog.getByRole('button', { name: 'Детальные правила по фазам' })
    await expect(firstRule).toBeVisible()
    const [timerWarningBox, firstRuleBox] = await Promise.all([
      timerWarning.boundingBox(),
      firstRule.boundingBox(),
    ])
    expect(timerWarningBox).not.toBeNull()
    expect(firstRuleBox).not.toBeNull()
    expect(timerWarningBox!.y + timerWarningBox!.height).toBeLessThanOrEqual(firstRuleBox!.y)
    await expect(page.getByRole('button', { name: 'Закрыть правила' })).toBeInViewport()
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expectPhase(page, headings.access)
  } finally {
    await guestContext.close()
  }
})

test('two players complete every Tender stage and receive each realtime phase transition', async ({ browser, page }) => {
  test.setTimeout(300_000)
  await registerBrowserUser(page, 'Хост E2E', 'room-host')
  const webOrigin = new URL(page.url()).origin

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(
    page.getByText('Сыграно матчей').locator('..').getByText('0', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()

  const guestContext = await browser.newContext({
    baseURL: webOrigin,
    viewport: { width: 390, height: 844 },
  })
  const guestPage = await guestContext.newPage()
  try {
    await registerBrowserUser(guestPage, 'Гость E2E', 'room-guest', webOrigin)

    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)

    const roomJoinCode = await readRoomJoinCode(page)

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await expect(guestPage.getByRole('dialog')).toBeVisible()
    await guestPage.getByLabel('Код комнаты').fill(roomJoinCode)
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
    const rulesDialog = page.getByRole('dialog')
    await expect(rulesDialog).toBeVisible()
    const tenderHeader = page.locator('header[aria-label="Текущая фаза игры"]')
    const tenderHeaderBox = await tenderHeader.boundingBox()
    const rulesDialogBox = await rulesDialog.boundingBox()
    expect(tenderHeaderBox).not.toBeNull()
    expect(rulesDialogBox).not.toBeNull()
    expect(rulesDialogBox!.y).toBeGreaterThanOrEqual(tenderHeaderBox!.y + tenderHeaderBox!.height)
    await expect(page.getByRole('button', { name: 'Детальные правила по фазам' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Закрыть правила' })).toBeInViewport()
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'ИСТОРИЯ МАТЧЕЙ' })).toBeHidden()
    await expectPhase(page, headings.access)
    await expectPhase(guestPage, headings.access)
    await expectSynchronizedTimers(page, guestPage)
    await expect(page.getByRole('heading', { name: 'Ваши образцы' })).toHaveCount(0)
    await expect(page.getByText('Данные исследования', { exact: true })).toHaveCount(0)
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
    await expect(page.getByRole('alert')).toContainText(
      'Не удалось выполнить действие. Обновите состояние матча и попробуйте ещё раз.',
    )
    await expect(page.getByRole('alert')).not.toContainText('Команда временно недоступна')
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
    await expect(page.getByText(/^Контракты этого раунда · \d+$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Правила' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Трактовка анализов' })).toBeEnabled()
    await runReconnaissance(page)
    await expectPhase(guestPage, headings.reconnaissance)
    await expect(guestPage.getByText(/^Контракты этого раунда · \d+$/)).toBeVisible()
    await runReconnaissance(guestPage)

    await expectPhase(page, headings.laboratory)
    await runLaboratory(page)
    await expectPhase(guestPage, headings.laboratory)
    await runLaboratory(guestPage)

    await expectPhase(page, headings.contracts)
    await expect(page.getByRole('heading', { name: 'Игроки' })).toHaveCount(1)
    await completeContract(page)
    await expectPhase(guestPage, headings.contracts)
    await completeContract(guestPage)

    for (let round = 2; round <= 5; round += 1) {
      await expectPhase(page, headings.access)
      await expectPhase(guestPage, headings.access)
      await expectSynchronizedTimers(page, guestPage)
      await expect(page.getByRole('heading', { name: 'Ваши образцы' })).toBeVisible()
      await expect(page.getByText('Данные исследования', { exact: true })).toBeVisible()
      await expect(page.getByText('Лаборатория, личные измерения и тезисы', { exact: true })).toBeVisible()
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
      await expect(page.getByText('История', { exact: true })).toBeVisible()
      await runLaboratory(guestPage)

      await expectPhase(page, headings.analysis)
      await expectPhase(guestPage, headings.analysis)
      await expect(guestPage.getByText('История лаборатории')).toHaveCount(0)
      await expect(
        guestPage.getByText('Данные исследования', { exact: true }).filter({ visible: true }),
      ).toHaveCount(1)
      if (round > 2) {
        const previousThesisCount = round - 2
        await expect(page.locator('[data-private-thesis]')).toHaveCount(previousThesisCount)
        await expect(page.getByText(`Всего: ${previousThesisCount} · раунд: 0/1`)).toBeVisible()
      }
      if (round === 2) await verifyWorkingModelModal(guestPage)
      await submitThesis(page)
      await submitThesis(guestPage)
    }

    await expectPhase(page, headings.final)
    await expectPhase(guestPage, headings.final)
    const finalTimer = page.getByRole('timer', { name: 'До конца фазы' })
    await expect.poll(async () => {
      const [minutes = 0, seconds = 0] = (await finalTimer.textContent() ?? '').split(':').map(Number)
      return minutes * 60 + seconds
    }).toBeGreaterThan(170)
    await expect(page.getByRole('heading', { name: 'Игроки' })).toHaveCount(0)
    await expect(page.getByText('Рабочая модель', { exact: true })).toHaveCount(0)
    await expect(guestPage.getByText('Подтвердили 0 из 2 исследователей').first()).toBeVisible()
    await expect(guestPage.getByRole('button', { name: 'Отправить финальную модель' })).toBeEnabled()
    await submitFinalModel(page)
    await expectPhase(guestPage, headings.final)
    await expect(page.getByRole('status')).toContainText('Финальная модель отправлена')
    await submitFinalModel(guestPage)
    await expect(page.getByText('Тендер завершён', { exact: true })).toBeVisible()
    await expect(guestPage.getByText('Тендер завершён', { exact: true })).toBeVisible()
    await expect(page.getByText('Итоговый рейтинг', { exact: true })).toBeVisible()
    await expect(page.getByText('За что начислен рейтинг', { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('За что начислен рейтинг игроку Хост E2E')).toContainText(
      /Начислений рейтинга нет|Верные тезисы|Выполненные контракты|Верные свойства модели|Полностью раскрытые сигналы|Бонус полной модели/,
    )
    await expect(page.getByRole('heading', { name: 'Конфигурация аномалии' })).toBeVisible()
    await expect(page.getByText('Раскрытые свойства шести сигналов', { exact: true })).toBeVisible()
    await expect(page.getByText('Финальная модель не отправлена')).toHaveCount(0)

    await page.getByRole('button', { name: 'Правила' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Таймер матча продолжает идти')).toHaveCount(0)
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await page.getByRole('button', { name: 'Трактовка анализов' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Таймер матча продолжает идти')).toHaveCount(0)
    await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

    await page.getByRole('button', { name: 'Выйти из матча' }).click()
    await expect(page).toHaveURL('/')
    await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
    await expect(
      page.getByText('Сыграно матчей').locator('..').getByText('1', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Завершите первый матч, чтобы появилась статистика.')).toHaveCount(0)
  } finally {
    await guestContext.close()
  }
})
