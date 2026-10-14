import type { Page } from '@playwright/test'

import { expect, registerBrowserUser, test } from '../helpers/test'

async function readRoomJoinCode(page: Page) {
  const code = (await page.getByTestId('room-join-code').textContent())?.trim()
  if (!code) throw new Error('Room join code is missing from the lobby')
  return code
}

async function chooseAccessSlot(page: Page, slot: number) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
}

async function allocateReconnaissance(page: Page) {
  await page.getByRole('button', { name: 'Увеличить мощность: Разведка' }).click()
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
  await page.getByRole('button', { name: 'Подтвердить и продолжить' }).click()
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

async function expectWorkingModelTableToStayStillWhileSaving(page: Page) {
  await page.route('**/api/tenders/*/commands', async (route) => {
    const command = route.request().postDataJSON() as { type?: string } | null
    if (command?.type === 'update-working-model') {
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    await route.continue()
  })

  const dialog = page.getByRole('dialog')
  const table = dialog.getByTestId('working-model-table')
  const fieldButton = dialog.getByRole('button', {
    name: /: гипотеза, тип поля Инерционное$/,
  }).first()
  await fieldButton.scrollIntoViewIfNeeded()
  const before = await table.boundingBox()
  expect(before).not.toBeNull()

  await fieldButton.click()
  const savingStatus = dialog.getByText('Сохраняем рабочую модель…', { exact: true })
  await expect(savingStatus).toBeVisible()
  const during = await table.boundingBox()
  expect(during).not.toBeNull()
  expect(Math.abs(during!.y - before!.y)).toBeLessThanOrEqual(0.1)
  expect(Math.abs(during!.height - before!.height)).toBeLessThanOrEqual(0.1)

  await expect(savingStatus).toBeHidden()
  await page.unrouteAll({ behavior: 'wait' })
}

test('Journal keeps one ordered window and pending model edits through tabs, close and server recovery', async ({
  browser,
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.context().addInitScript(() => {
    const controlledWindow = window as Window & { __e2eWebSockets: WebSocket[] }
    const NativeWebSocket = window.WebSocket
    controlledWindow.__e2eWebSockets = []
    Object.defineProperty(window, 'WebSocket', { configurable: true,
      value: class TrackedWebSocket extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          if (protocols === undefined) super(url)
          else super(url, protocols)
          controlledWindow.__e2eWebSockets.push(this)
        }
      },
    })
  })
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
    const roomJoinCode = await readRoomJoinCode(page)

    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('Код комнаты').fill(roomJoinCode)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Начать игру' }).click()

    await chooseAccessSlot(page, 1)
    await chooseAccessSlot(guestPage, 2)
    await allocateReconnaissance(page)
    await allocateReconnaissance(guestPage)

    await expect(page.getByRole('heading', { name: '3. Разведка' })).toBeVisible()
    const workingModelButton = page.getByRole('button', { name: 'Открыть журнал', exact: true })
    await expect(workingModelButton).toBeEnabled()
    await page.getByRole('button', { name: /^Сигнал для разведки:/ }).first().click()
    await page.getByRole('button', { name: 'Исследовать' }).click()
    await expect(guestPage.getByRole('heading', { name: '3. Разведка' })).toBeVisible()
    await expect(workingModelButton).toBeEnabled()
    await workingModelButton.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCount(1)
    await expect(dialog.getByRole('tab')).toHaveText([
      'Рабочая модель', 'Данные исследований', 'Трактовка',
    ])
    const hypothesis = dialog.getByRole('button', {
      name: /: гипотеза, тип поля Инерционное$/,
    }).first()
    const acceptedSave = page.waitForResponse((response) => {
      const command = response.request().postDataJSON() as { type?: string } | null
      return response.url().includes('/commands') && command?.type === 'update-working-model' && response.ok()
    })
    await hypothesis.click()
    await dialog.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
    await dialog.getByRole('tab', { name: 'Трактовка', exact: true }).click()
    await expect(dialog).toHaveCount(1)
    await dialog.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await workingModelButton.click()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    await acceptedSave
    await page.reload()
    await expect(workingModelButton).toBeEnabled()
    await workingModelButton.click()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    await expectWorkingModelTableToStayStillWhileSaving(page)
    let rejectSave = true
    await page.route('**/api/tenders/*/commands', async (route) => {
      const command = route.request().postDataJSON() as { type?: string } | null
      if (command?.type === 'update-working-model' && rejectSave) {
        await route.fulfill({ status: 429, contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Temporary test save rejection' } }) })
      } else await route.continue()
    })
    await hypothesis.click()
    await expect(dialog.getByRole('button', { name: 'Повторить сохранение' })).toBeVisible()
    await dialog.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(workingModelButton).toBeFocused()
    await workingModelButton.click()
    await expect(dialog.getByRole('tab', { name: 'Данные исследований', exact: true })).toHaveAttribute('aria-selected', 'true')
    await dialog.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    const retriedSave = page.waitForResponse((response) => {
      const command = response.request().postDataJSON() as { type?: string } | null
      return response.url().includes('/commands') && command?.type === 'update-working-model' && response.ok()
    })
    rejectSave = false
    await dialog.getByRole('button', { name: 'Повторить сохранение' }).click()
    await retriedSave
    await expect(dialog.getByRole('button', { name: 'Повторить сохранение' })).toBeHidden()
    await page.unrouteAll({ behavior: 'wait' })
    await page.route('**/api/realtime/tickets', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Test reconnect hold' } }) })
    })
    await page.evaluate(() => {
      const sockets = (window as Window & { __e2eWebSockets: WebSocket[] }).__e2eWebSockets
      const open = sockets.filter((socket) => socket.readyState === WebSocket.OPEN && socket.url.includes('/api/realtime/ws'))
      if (open.length === 0) throw new Error('No open Tender WebSocket')
      for (const socket of open) socket.close()
    })
    const reconnect = page.getByRole('alertdialog', { name: 'Связь с сервером прервана' })
    await expect(reconnect).toBeVisible()
    await expect(dialog).toBeHidden()
    await page.unroute('**/api/realtime/tickets')
    await reconnect.getByRole('button', { name: 'Переподключиться' }).click()
    await expect(reconnect).toBeHidden()
    await workingModelButton.click()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    const modelTab = dialog.getByRole('tab', { name: 'Рабочая модель', exact: true })
    await modelTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(dialog.getByRole('tab', { name: 'Данные исследований', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(dialog.getByRole('tab', { name: 'Трактовка', exact: true })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(modelTab).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[hidden], [inert]') === null)).toBe(true)
    await guestPage.getByRole('button', { name: /^Сигнал для разведки:/ }).first().click()
    await guestPage.getByRole('button', { name: 'Исследовать' }).click()
    await expect(guestPage.getByRole('heading', { name: '3. Разведка' })).toBeHidden()
    await guestPage.getByRole('button', { name: 'Открыть журнал', exact: true }).click()
    await guestPage.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await expect(guestPage.getByRole('dialog').getByRole('button', { name: /: гипотеза,/ }).first()).toHaveAttribute('aria-pressed', 'false')
    await guestPage.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    await workingModelButton.click()
    await expectDialogInsideViewport(page)

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }))
    await workingModelButton.click()
    await expectDialogInsideViewport(page)

    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(page.getByRole('button', { name: 'Открыть журнал', exact: true })).toBeVisible()
    await expect(page.getByTestId('working-model-table')).toHaveCount(0)
    expect(runtimeErrors).toEqual([])
  } finally {
    await guestContext.close()
  }
})


test('connected Research remains readable in the real last ten seconds of Laboratory and closes on the server phase transition', async ({ browser, page }) => {
  test.setTimeout(180_000)
  await registerBrowserUser(page, 'Хост срочного журнала', 'urgent-journal-host')
  const webOrigin = new URL(page.url()).origin
  const guestContext = await browser.newContext({ baseURL: webOrigin, viewport: { width: 390, height: 844 } })
  const guest = await guestContext.newPage()
  try {
    await registerBrowserUser(guest, 'Гость срочного журнала', 'urgent-journal-guest', webOrigin)
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ', exact: true }).click()
    await page.getByLabel('Количество игроков').selectOption('2')
    await page.getByRole('button', { name: 'Создать команду', exact: true }).click()
    const joinCode = await readRoomJoinCode(page)
    await guest.getByRole('button', { name: 'ВОЙТИ ПО КОДУ', exact: true }).click()
    await guest.getByLabel('Код комнаты').fill(joinCode)
    await guest.getByRole('button', { name: 'Войти по коду', exact: true }).click()
    await guest.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Начать игру', exact: true }).click()
    await chooseAccessSlot(page, 6)
    await chooseAccessSlot(guest, 5)
    for (const player of [page, guest]) {
      for (const [category, power] of [['Разведка', 1], ['Лаборатория', 2], ['Анализ модели', 1]] as const) {
        for (let i = 0; i < power; i++) await player.getByRole('button', { name: `Увеличить мощность: ${category}`, exact: true }).click()
      }
      await player.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
    }
    // Slot 5 acts before slot 6. Leave the host's Laboratory action unresolved for its real deadline.
    for (const player of [guest, page]) {
      await player.getByRole('button', { name: 'Сигнал для разведки: Aster', exact: true }).click()
      await player.getByRole('button', { name: 'Исследовать', exact: true }).click()
    }
    await guest.getByRole('button', { name: /^Глубокое/ }).click()
    const samples = guest.getByRole('button', { name: /^Образец:/ })
    await expect(samples).toHaveCount(2)
    // Selecting the source changes its accessible name; retain both identities first.
    const sampleNames = await samples.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')!))
    for (const sampleName of sampleNames) {
      await guest.getByRole('button', { name: sampleName, exact: true }).click()
    }
    const accepted = guest.waitForResponse((response) => response.url().includes('/commands') && response.request().postDataJSON()?.type === 'run-laboratory-test' && response.ok())
    await guest.getByRole('button', { name: /^Провести опыт:/ }).click()
    await accepted
    await expect(page.getByRole('heading', { name: '4. Лаборатория', exact: true })).toBeVisible()
    const entry = guest.getByRole('button', { name: 'Открыть журнал', exact: true })
    await entry.click()
    const journal = guest.getByRole('dialog', { name: 'Журнал исследований', exact: true })
    await journal.getByRole('tab', { name: 'Данные исследований', exact: true }).click()
    await expect(journal.locator('[data-own-experiment]')).toHaveCount(1)
    await expect(journal).toContainText('Личные измерения')
    await journal.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
    await guest.keyboard.press('Escape')
    await expect.poll(async () => {
      const text = await guest.getByRole('timer', { name: 'До конца фазы', exact: true }).textContent()
      const [minutes, seconds] = (text ?? '').split(':').map(Number)
      return minutes! * 60 + seconds!
    }, { timeout: 100_000, intervals: [1000] }).toBeLessThanOrEqual(10)
    await expect(entry).toBeEnabled()
    await entry.click()
    await expect(journal.getByRole('tab', { name: 'Данные исследований', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(journal.getByRole('tab', { name: 'Рабочая модель', exact: true })).toBeDisabled()
    await expect(journal.getByRole('tab', { name: 'Трактовка', exact: true })).toBeDisabled()
    await expect(journal.locator('[data-own-experiment]')).toHaveCount(1)
    await expect(journal).toContainText('Только вы')
    await expect(guest.locator('[role="timer"]')).toBeVisible()
    await expect(journal).toBeHidden({ timeout: 20_000 })
    await expect(guest.getByRole('heading', { name: '4. Лаборатория', exact: true })).toBeHidden()
    await expect(guest.getByRole('button', { name: 'Открыть журнал', exact: true })).toBeEnabled()
  } finally {
    await guestContext.close()
  }
})
