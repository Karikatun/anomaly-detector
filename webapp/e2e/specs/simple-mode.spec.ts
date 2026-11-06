import { gameContractVersionHeader } from '@anomaly-detector/contracts'
import { expect, registerBrowserUser, test } from '../helpers/test'
import { randomUUID } from 'node:crypto'
import type { WebSocketRoute } from '@playwright/test'

test('простой режим сохраняет разрешение ботов и создаёт комнату выбранного режима', async ({ page }) => {
  await registerBrowserUser(page, 'Игрок E2E', 'simple-mode')
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  const dialog = page.getByRole('dialog')
  const bots = dialog.getByRole('checkbox', { name: 'Возможность добавить ботов' })
  await bots.check()
  await dialog.getByLabel('Режим игры').selectOption('simple')
  if (process.env.MODE77_UI_AUDIT_DIR) await page.screenshot({ path: `${process.env.MODE77_UI_AUDIT_DIR}/after-simple-create.png`, animations: 'disabled' })
  await expect(bots).toBeChecked()
  await expect(bots).toBeEnabled()
  await bots.focus()
  await expect(bots).toBeFocused()
  await bots.press('Space')
  await expect(bots).not.toBeChecked()
  await bots.press('Space')
  await expect(bots).toBeChecked()
  await expect(dialog.getByText('Боты недоступны в этом режиме')).toHaveCount(0)
  await page.route('**/api/rooms', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Тестовая ошибка создания' } }) })
    : route.continue())
  await dialog.getByRole('button', { name: 'Создать команду' }).click()
  await expect(dialog.getByText('Тестовая ошибка создания')).toBeVisible()
  await page.unroute('**/api/rooms')
  const request = page.waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/rooms')
  await dialog.getByRole('button', { name: 'Создать команду' }).click()
  expect((await request).postDataJSON()).toMatchObject({ mode: 'simple', allowBots: true })
  await expect(page.getByRole('heading', { name: 'Лобби' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Лобби', exact: true })).toBeVisible()
  await expect(page.getByText('Простой', { exact: true })).toBeVisible()
  await page.goto('/profile')
  const mode = page.getByLabel('Режим игры')
  await expect(mode).toHaveValue('standard')
  await mode.selectOption('simple')
  await expect(page.getByText('Средний рейтинг')).toHaveCount(0)
})

test('двое игроков завершают три раунда и видят серверный результат', async ({ browser, page }) => {
  test.setTimeout(90_000)
  let viewSocket: WebSocketRoute | undefined
  let latestView: Record<string, unknown> | undefined
  await page.routeWebSocket(/\/api\/realtime\/ws/, (socket) => {
    viewSocket = socket
    const server = socket.connectToServer()
    server.onMessage((message) => {
      if (typeof message === 'string') {
        const parsed = JSON.parse(message) as { type: string; view?: Record<string, unknown> }
        if (parsed.type === 'tender-view') latestView = parsed.view
      }
      socket.send(message)
    })
  })
  await page.context().addInitScript(() => {
    const tracked = window as Window & { __mode76Sockets: WebSocket[] }
    const NativeWebSocket = window.WebSocket
    tracked.__mode76Sockets = []
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) super(url)
        else super(url, protocols)
        tracked.__mode76Sockets.push(this)
      }
    } })
  })
  async function register(target: typeof page, name: string) {
    const response = target.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/auth/register')
    await registerBrowserUser(target, name, 'simple-journey')
    const result = await response
    const body = await result.json() as { accessToken: string; user: { id: string } }
    return { token: body.accessToken, id: body.user.id, origin: new URL(result.url()).origin }
  }
  const host = await register(page, 'Первый игрок')
  const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const guestPage = await guestContext.newPage()
  try {
    const guest = await register(guestPage, 'Второй игрок')
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await page.getByLabel('Режим игры').selectOption('simple')
    await page.getByRole('dialog').getByRole('checkbox', { name: 'Возможность добавить ботов' }).uncheck()
    await page.getByRole('dialog').getByRole('button', { name: 'Создать команду' }).click()
    const code = (await page.getByTestId('room-join-code').textContent())?.trim()
    if (!code) throw new Error('Нет кода комнаты')
    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('Код комнаты').fill(code)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await expect(page).toHaveURL(/\/tenders\/[^/]+$/, { timeout: 20_000 })
    await expect(page.getByText('Раунд 1 / 3')).toBeVisible()
    await expect.poll(() => Boolean(viewSocket && latestView)).toBe(true)
    // Visual-only fixture: retain a real server view and substitute the player's full inventory.
    const fixture = structuredClone(latestView!)
    fixture.round = 2
    fixture.privateSamples = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro']
    viewSocket!.send(JSON.stringify({ type: 'tender-view', view: fixture }))
    await expect(page.getByText(/Все шесть образцов собраны/)).toBeVisible()
    if (process.env.MODE76_UI_AUDIT_DIR) await page.screenshot({ path: `${process.env.MODE76_UI_AUDIT_DIR}/full-samples-fixture.png`, animations: 'disabled' })
    fixture.phase = 'power-allocation'
    viewSocket!.send(JSON.stringify({ type: 'tender-view', view: fixture }))
    await expect(page.getByRole('button', { name: 'Увеличить мощность: Разведка' })).toBeDisabled()
    fixture.phase = 'model-analysis'
    fixture.knownSignals = fixture.privateSamples
    fixture.activePlayerId = host.id
    fixture.players = (fixture.players as Array<Record<string, unknown>>).map((player) => player.playerId === host.id
      ? { ...player, budget: 0, modelAnalysisCompleted: false, powerAllocation: { reconnaissance: 0, laboratory: 0, modelAnalysis: 2, contracts: 0, reserve: 2 } }
      : player)
    fixture.privateTheses = [{ id: 'fixture-correct', signalId: 'aster', fieldType: 'phase', polarity: 'positive', fieldTypeCorrect: true, polarityCorrect: true, fullyCorrect: true, round: 2 }]
    viewSocket!.send(JSON.stringify({ type: 'tender-view', view: fixture }))
    await expect(page.getByLabel('Сигнал для тезиса')).toBeEnabled()
    await expect(page.getByText(/Первый тезис неверен/)).toHaveCount(0)
    fixture.players = (fixture.players as Array<Record<string, unknown>>).map((player) => player.playerId === host.id
      ? { ...player, modelAnalysisCompleted: true } : player)
    fixture.privateTheses = [{ id: 'fixture-wrong', signalId: 'aster', fieldType: 'phase', polarity: 'positive', fieldTypeCorrect: false, polarityCorrect: false, fullyCorrect: false, round: 2 }]
    viewSocket!.send(JSON.stringify({ type: 'tender-view', view: fixture }))
    await expect(page.getByLabel('Сигнал для тезиса')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Выдвинуть тезис' })).toBeDisabled()
    await expect(page.getByText(/Первый тезис неверен/)).toBeVisible()
    if (process.env.MODE76_UI_AUDIT_DIR) await page.screenshot({ path: `${process.env.MODE76_UI_AUDIT_DIR}/analysis-burn-fixture.png`, animations: 'disabled' })
    await page.reload()
    await expect(page.getByText('Раунд 1 / 3')).toBeVisible()
    await expect(page.getByText('На связи', { exact: true })).toBeVisible()
    await page.context().setOffline(true)
    await page.evaluate(() => {
      const tracked = window as Window & { __mode76Sockets: WebSocket[] }
      tracked.__mode76Sockets.filter((socket) => socket.readyState === WebSocket.OPEN && socket.url.includes('/api/realtime/ws')).forEach((socket) => socket.close(4001, 'E2E disconnect'))
    })
    await expect(page.getByText('Соединение потеряно')).toBeVisible()
    await page.context().setOffline(false)
    await expect(page.getByText('На связи', { exact: true })).toBeVisible({ timeout: 20_000 })
    if (process.env.MODE76_UI_AUDIT_DIR) {
      for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
        await page.setViewportSize({ width, height })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: `${process.env.MODE76_UI_AUDIT_DIR}/access-${width}.png`, animations: 'disabled' })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    const tenderId = page.url().split('/').at(-1)!
    const command = async (actor: typeof host, payload: Record<string, unknown>) => {
      const data = { ...payload, actorId: actor.id, commandId: randomUUID(), tenderId }
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await page.request.post(`${actor.origin}/api/tenders/${tenderId}/commands`, {
          headers: { Authorization: `Bearer ${actor.token}`, [gameContractVersionHeader]: '2' }, data,
        })
        if (response.ok()) return
        const body = await response.json() as { error?: { code?: string } }
        if (response.status() === 409 && body.error?.code === 'TENDER_VERSION_CONFLICT' && attempt < 3) continue
        throw new Error(`Команда ${String(payload.type)}: ${response.status()} ${body.error?.code}`)
      }
    }
    const read = async () => {
      const response = await page.request.get(`${host.origin}/api/tenders/${tenderId}`, { headers: { Authorization: `Bearer ${host.token}`, [gameContractVersionHeader]: '2' } })
      expect(response.ok()).toBe(true)
      return response.json() as Promise<{ phase: string; round: number; game: { mode: string }; privateSamples: string[]; audit?: { rounds: unknown[] } }>
    }
    await page.getByRole('button', { name: /^Слот доступа 1:/ }).click()
    const slotResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().postDataJSON()?.type === 'request-access-slot')
    await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
    expect((await slotResponse).status()).toBe(200)
    await command(guest, { type: 'request-access-slot', slot: 3 })
    await expect(page.getByText(/Бюджет закончился: после первой неверной проверки/)).toBeVisible()
    for (const category of ['Разведка', 'Разведка', 'Лаборатория', 'Лаборатория']) {
      await page.getByRole('button', { name: `Увеличить мощность: ${category}` }).click()
    }
    const allocationResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().postDataJSON()?.type === 'allocate-power')
    await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
    expect((await allocationResponse).status()).toBe(200)
    await command(guest, { type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } })
    const random = page.getByRole('button', { name: /Сигнал для разведки: Случайный поиск 1/ })
    if (process.env.MODE76_UI_AUDIT_DIR) {
      for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
        await page.setViewportSize({ width, height })
        await expect(random).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: `${process.env.MODE76_UI_AUDIT_DIR}/recon-${width}.png`, animations: 'disabled' })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    await random.click()
    const direct = page.getByRole('button', { name: /Сигнал для разведки: Aster/ })
    await direct.focus()
    await expect(direct).toBeFocused()
    await direct.press('Enter')
    await expect(direct).toHaveAttribute('aria-pressed', 'true')
    const reconResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().postDataJSON()?.type === 'conduct-reconnaissance')
    await page.getByRole('button', { name: 'Исследовать' }).click()
    const acceptedRecon = await reconResponse
    expect(acceptedRecon.request().postDataJSON().targets).toEqual(['unknown-sector', 'aster'])
    expect(acceptedRecon.status()).toBe(200)
    const collected = (await read()).privateSamples
    expect(collected).toContain('aster')
    expect(new Set(collected).size).toBe(2)
    await page.getByRole('button', { name: /^Глубокое/ }).click()
    await expect(page.getByText('Результат и измерение видите только вы')).toBeVisible()
    const samples = page.locator('[data-tutorial-lab-sample]')
    await samples.nth(0).click()
    await samples.nth(1).click()
    const labResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().postDataJSON()?.type === 'run-laboratory-test')
    await page.getByRole('button', { name: /^Провести опыт:/ }).click()
    expect((await labResponse).status()).toBe(200)
    for (let round = 2; round <= 3; round++) {
      expect((await read()).round).toBe(round)
      for (const actor of [host, guest]) await command(actor, { type: 'request-access-slot', slot: 3 })
      for (const actor of [host, guest]) await command(actor, { type: 'allocate-power', allocation: { contracts: 0, laboratory: 0, modelAnalysis: 0, reconnaissance: 0, reserve: 4 } })
    }
    expect((await read()).phase).toBe('final-scientific-model')
    await command(guest, { type: 'submit-scientific-model', scientificModel: { signals: { aster: { fieldType: 'phase', polarity: 'positive' } } } })
    for (const signal of ['Aster', 'Boreal', 'Cinder', 'Delta', 'Eclipse', 'Ferro']) {
      const field = page.getByRole('combobox', { name: `${signal}: тип поля`, exact: true })
      if (await field.isVisible()) {
        await field.selectOption({ index: 1 })
        await page.getByRole('combobox', { name: `${signal}: полярность`, exact: true }).selectOption({ index: 1 })
      } else {
        await page.getByRole('button', { name: new RegExp(`^${signal}: тип поля `) }).first().click()
        await page.getByRole('button', { name: new RegExp(`^${signal}: полярность `) }).first().click()
      }
    }
    const finalResponse = page.waitForResponse((r) => r.request().method() === 'POST' && r.request().postDataJSON()?.type === 'submit-scientific-model')
    await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
    expect((await finalResponse).status()).toBe(200)
    const result = await read()
    expect(result.phase).toBe('complete')
    expect(result.audit?.rounds).toHaveLength(3)
    await expect(page.locator('#completed-tender-heading')).toBeVisible()
    await expect(page.getByText('Простой', { exact: true }).first()).toBeVisible()
    if (process.env.MODE76_UI_AUDIT_DIR) {
      for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]] as const) {
        await page.setViewportSize({ width, height })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: `${process.env.MODE76_UI_AUDIT_DIR}/result-${width}.png`, animations: 'disabled' })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Полный разбор партии' }).click()
    await expect(page.getByRole('dialog').locator('[data-audit-round]')).toHaveCount(3)
    await page.goto('/app')
    const match = page.getByRole('row').filter({ hasText: 'Второй игрок' })
    await expect(match.getByText('Простой', { exact: true })).toBeVisible()
    await match.getByRole('button', { name: 'Открыть результаты' }).click()
    await expect(page.locator('#completed-tender-heading')).toBeVisible()
  } finally {
    await guestContext.close()
  }
})
