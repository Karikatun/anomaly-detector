import type { CDPSession, Page } from '@playwright/test'
import { expect, registerBrowserUser, test } from '../helpers/test'

const guardName = 'Поверните телефон вертикально'

async function rotatePhone(page: Page, session: CDPSession, landscape: boolean) {
  const width = landscape ? 844 : 390
  const height = landscape ? 390 : 844
  // Keep Playwright's viewport metadata aligned so screenshots do not restore the old metrics.
  await page.setViewportSize({ width, height })
  await session.send('Emulation.setDeviceMetricsOverride', {
    width, height, screenWidth: width, screenHeight: height,
    deviceScaleFactor: 1, mobile: true,
    screenOrientation: {
      type: landscape ? 'landscapePrimary' : 'portraitPrimary',
      angle: landscape ? 90 : 0,
    },
  })
}

async function openGuestModel(page: Page) {
  await page.goto('/learn')
  await page.getByRole('button', { name: 'Начать обучение', exact: true }).click()
  // The full lesson is covered separately; resume its supported local draft at model editing.
  await page.evaluate(() => {
    const key = 'anomaly-detector:guest-tutorial-session'
    const saved = sessionStorage.getItem(key)
    if (!saved) throw new Error('Guest lesson draft is missing')
    const state = JSON.parse(saved)
    state.step = 'round-2-working-model'
    sessionStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Открыть журнал', exact: true }).click()
  await page.getByRole('tab', { name: 'Рабочая модель', exact: true }).click()
}

test.describe('phone physical orientation', () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('preserves an open journal and selection while blocking landscape interaction', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Native screen orientation emulation requires Chromium CDP')
    const session = await page.context().newCDPSession(page)
    await rotatePhone(page, session, false)
    await openGuestModel(page)
    const journal = page.getByRole('dialog', { name: 'Журнал исследований' })
    const hypothesis = journal.getByRole('button', { name: 'Aster: гипотеза, тип поля Фазовое', exact: true })
    await hypothesis.click()
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    await hypothesis.focus()
    await journal.evaluate((element) => { (element as HTMLElement).dataset.portraitWitness = 'same-window' })
    await page.screenshot({ path: testInfo.outputPath('portrait-journal.png') })
    await rotatePhone(page, session, true)
    const guard = page.getByRole('dialog', { name: guardName })
    await expect(guard).toBeVisible()
    await expect(guard).toContainText('Игра продолжается.')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('landscape-guard.png') })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(guard).toBeFocused()
    // A programmatic focus attempt on the still-mounted lower dialog must stay blocked.
    await page.getByRole('dialog', { name: 'Журнал исследований', includeHidden: true })
      .getByRole('button', { name: 'Aster: гипотеза, тип поля Фазовое', exact: true, includeHidden: true })
      .evaluate((element) => (element as HTMLElement).focus())
    await expect(guard).toBeFocused()
    await page.mouse.click(20, 20)
    await expect(guard).toBeVisible()
    await rotatePhone(page, session, false)
    await expect(guard).toBeHidden()
    await expect(journal).toBeVisible()
    await expect(journal).toHaveAttribute('data-portrait-witness', 'same-window')
    await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
    await expect(hypothesis).toBeFocused()
    await expect(journal.getByRole('tab', { name: 'Рабочая модель', exact: true })).toHaveAttribute('aria-selected', 'true')
  })

  test('guards a landscape launch and leaves authentication and portrait keyboard resizing usable', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Native screen orientation emulation requires Chromium CDP')
    const session = await page.context().newCDPSession(page)
    await rotatePhone(page, session, true)
    await page.goto('/learn')
    const guard = page.getByRole('dialog', { name: guardName })
    await expect(guard).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.keyboard.press('Tab')
    await expect(guard).toBeFocused()
    await rotatePhone(page, session, false)
    await expect(page.getByRole('dialog', { name: 'Добро пожаловать на исследовательскую станцию' })).toBeVisible()
    await rotatePhone(page, session, true)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Вход', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: guardName })).toHaveCount(0)
    await rotatePhone(page, session, false)
    await page.goto('/learn')
    await page.setViewportSize({ width: 390, height: 260 })
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 260, screenWidth: 390, screenHeight: 844,
      deviceScaleFactor: 1, mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    })
    await expect(page.getByRole('dialog', { name: guardName })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Начать обучение', exact: true })).toBeVisible()
  })

  test('finishes an in-flight real autosave and receives the next server phase while landscape is blocked', async ({ page, browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Native screen orientation emulation requires Chromium CDP')
    await page.context().addInitScript(() => {
      const tracked = window as Window & { __portraitSockets: WebSocket[] }
      const Native = window.WebSocket
      tracked.__portraitSockets = []
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          if (protocols === undefined) super(url)
          else super(url, protocols)
          if (new URL(this.url).pathname === '/api/realtime/ws') tracked.__portraitSockets.push(this)
        }
      }
    })
    const session = await page.context().newCDPSession(page)
    await rotatePhone(page, session, false)
    await registerBrowserUser(page, 'Поворот хоста', 'portrait-host')
    const origin = new URL(page.url()).origin
    const guestContext = await browser.newContext({ baseURL: origin })
    const guest = await guestContext.newPage()
    let releaseSave: (() => void) | undefined
    try {
      await registerBrowserUser(guest, 'Поворот гостя', 'portrait-guest', origin)
      await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
      await page.getByLabel('Количество игроков').selectOption('2')
      await page.getByRole('button', { name: 'Создать команду' }).click()
      const code = (await page.getByTestId('room-join-code').textContent())?.trim()
      if (!code) throw new Error('Room join code is missing')
      await guest.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
      await guest.getByLabel('Код комнаты').fill(code)
      await guest.getByRole('button', { name: 'Войти по коду' }).click()
      await guest.getByRole('button', { name: 'Готов', exact: true }).click()
      await page.getByRole('button', { name: 'Готов', exact: true }).click()
      await page.getByRole('button', { name: 'Начать игру' }).click()
      for (const [player, slot] of [[page, 1], [guest, 2]] as const) {
        await player.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
        await player.getByRole('button', { name: 'Подтвердить выбор' }).click()
      }
      for (const player of [page, guest]) {
        await player.getByRole('button', { name: 'Увеличить мощность: Разведка' }).click()
        await player.getByRole('button', { name: 'Подтвердить распределение' }).click()
        await player.getByRole('button', { name: 'Подтвердить и продолжить' }).click()
      }
      await page.getByRole('button', { name: /^Сигнал для разведки:/ }).first().click()
      await page.getByRole('button', { name: 'Исследовать' }).click()
      await expect(guest.getByRole('heading', { name: '3. Разведка' })).toBeVisible()
      await page.getByRole('button', { name: 'Открыть журнал', exact: true }).click()
      const journal = page.getByRole('dialog', { name: 'Журнал исследований' })
      const hypothesis = journal.getByRole('button', { name: /: гипотеза, тип поля Инерционное$/ }).first()
      const gameDocumentTimeOrigin = await page.evaluate(() => performance.timeOrigin)
      const socketState = await page.evaluate(() => {
        const sockets = (window as Window & { __portraitSockets: WebSocket[] }).__portraitSockets
        return { count: sockets.length, open: sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length }
      })
      expect(socketState.open).toBeGreaterThan(0)
      const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
      let modelWrites = 0
      await page.route('**/api/tenders/*/commands', async (route) => {
        if (route.request().postDataJSON()?.type === 'update-working-model') {
          modelWrites += 1
          await saveGate
        }
        await route.continue()
      })
      const requestStarted = page.waitForRequest((request) => request.url().endsWith('/commands') && request.postDataJSON()?.type === 'update-working-model')
      const saved = page.waitForResponse((response) => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'update-working-model' && response.ok())
      await hypothesis.click()
      await requestStarted
      await rotatePhone(page, session, true)
      await expect(page.getByRole('dialog', { name: guardName })).toBeVisible()
      releaseSave!()
      await saved
      await guest.getByRole('button', { name: /^Сигнал для разведки:/ }).first().click()
      await guest.getByRole('button', { name: 'Исследовать' }).click()
      await expect(guest.getByRole('heading', { name: '3. Разведка' })).toBeHidden()
      await expect(page.locator('header[aria-label="Текущая фаза игры"]')).toContainText('Раунд 2 / 5')
      await rotatePhone(page, session, false)
      await expect(page.getByRole('dialog', { name: guardName })).toBeHidden()
      await expect(journal).toBeVisible()
      await expect(hypothesis).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => page.evaluate(() => {
        const sockets = (window as Window & { __portraitSockets: WebSocket[] }).__portraitSockets
        return { count: sockets.length, open: sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length }
      })).toEqual(socketState)
      expect(modelWrites).toBe(1)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: '1. Выбор слота' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Исследовать', exact: true })).toHaveCount(0)
      // Realtime recovery may open a new modal while the screen is already blocked.
      await rotatePhone(page, session, true)
      await expect.poll(() => page.evaluate(() => (window as Window & { __portraitSockets: WebSocket[] }).__portraitSockets.filter((socket) => socket.readyState === WebSocket.OPEN).length)).toBe(socketState.open)
      await expect(page.locator('header[aria-label="Текущая фаза игры"]')).toContainText('Раунд 2 / 5')
      await page.route('**/api/realtime/tickets', (route) => route.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Test reconnect hold' } }),
      }))
      const rejectedTicket = page.waitForResponse((response) => response.url().endsWith('/api/realtime/tickets') && response.status() === 503)
      await page.evaluate(() => {
        for (const socket of (window as Window & { __portraitSockets: WebSocket[] }).__portraitSockets) {
          if (socket.readyState === WebSocket.OPEN) socket.close()
        }
      })
      await expect(page.locator('[role="status"]', { hasText: 'Соединение потеряно' })).toHaveCount(1)
      await rejectedTicket
      await expect(page.getByRole('dialog', { name: guardName })).toBeFocused()
      await expect(page.getByRole('alertdialog', { name: 'Связь с сервером прервана' })).toHaveCount(0)
      await rotatePhone(page, session, false)
      const reconnect = page.getByRole('alertdialog', { name: 'Связь с сервером прервана' })
      await page.screenshot({ path: testInfo.outputPath('portrait-late-recovery.png') })
      await expect(reconnect).toBeVisible()
      await expect(reconnect.getByRole('button', { name: 'Переподключиться' })).toBeFocused()
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(gameDocumentTimeOrigin)
    } finally {
      releaseSave?.()
      await page.unrouteAll({ behavior: 'wait' })
      await guestContext.close()
    }
  })
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
  test(`keeps desktop landscape available at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/learn')
    await expect(page.getByRole('button', { name: 'Начать обучение', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: guardName })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('desktop-prologue.png') })
    const manifest = await page.request.get('/site.webmanifest')
    expect((await manifest.json()).orientation).toBe('portrait')
  })
}
