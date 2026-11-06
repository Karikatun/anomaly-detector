import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { randomUUID } from 'node:crypto'
import { gameContractVersionHeader, tenderViewSchema } from '@anomaly-detector/contracts'
import type { APIRequestContext, Page } from '@playwright/test'

import { expect, registerBrowserUser, test } from '../helpers/test'

const auditDirectory = process.env.ROOM_BOTS_AUDIT_DIR

async function capture(page: Page, name: string) {
  if (!auditDirectory) return

  await mkdir(auditDirectory, { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    path: resolve(auditDirectory, `${name}.png`),
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function registerWithAccessToken(page: Page) {
  const registered = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/register')
  await registerBrowserUser(page, 'Хост бота E2E', 'room-bot-host')
  const response = await registered
  const payload = await response.json() as { accessToken?: unknown; user?: { id?: unknown } }
  if (!response.ok() || typeof payload.accessToken !== 'string' || typeof payload.user?.id !== 'string') throw new Error('Registration did not return an access token and user id')
  return { accessToken: payload.accessToken, apiOrigin: new URL(response.url()).origin, id: payload.user.id }
}

async function sendHumanCommand(request: APIRequestContext, apiOrigin: string, accessToken: string, tenderId: string, command: Record<string, unknown>) {
  const data = { ...command, actorId: command.actorId, commandId: randomUUID(), tenderId }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request.post(`${apiOrigin}/api/tenders/${tenderId}/commands`, {
      data,
      headers: { Authorization: `Bearer ${accessToken}`, [gameContractVersionHeader]: '2' },
    })
    if (response.ok()) return
    const body = await response.json() as { error?: { code?: string } }
    // Concurrent bot writes can win the optimistic commit. Reuse the intent ID
    // so a receipt, if present, remains idempotent. Other failures are defects.
    if (response.status() === 409 && body.error?.code === 'TENDER_VERSION_CONFLICT' && attempt < 3) continue
    throw new Error(`Tender command ${String(command.type)} failed with ${response.status()}: ${JSON.stringify(body)}`)
  }
}

for (const scenario of [
  { mode: 'standard', rounds: 5, difficulty: 'easy' as const, label: 'Бот · лёгкий', screenshot: 'easy' },
  { mode: 'simple', rounds: 3, difficulty: 'easy' as const, label: 'Бот · лёгкий', screenshot: 'simple-easy' },
  { mode: 'simple', rounds: 3, difficulty: 'hard' as const, label: 'Бот · сложный', screenshot: 'simple-hard' },
  { mode: 'standard', rounds: 5, difficulty: 'hard' as const, label: 'Бот · сложный', screenshot: 'hard' },
]) test(`host completes ${scenario.rounds} real-worker rounds in ${scenario.mode} with a ${scenario.difficulty} server bot`, async ({ page }) => {
  test.setTimeout(180_000)
  const initialBotLabel = 'Бот · лёгкий'
  await page.setViewportSize({ width: 1440, height: 900 })
  const session = await registerWithAccessToken(page)

  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const allowBots = dialog.getByRole('checkbox', { name: 'Возможность добавить ботов' })
  await expect(allowBots).not.toBeChecked()
  await allowBots.check()
  await dialog.getByLabel('Режим игры').selectOption(scenario.mode)
  await expect(allowBots).toBeChecked()
  await page.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Лобби' })).toBeVisible()

  const addBot = page.getByRole('button', { name: 'Добавить лёгкого бота' })
  await page.route('**/api/rooms/*/bots', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'E2E bot roster failure' } }),
        contentType: 'application/json',
        status: 500,
      })
      return
    }
    await route.continue()
  })
  await addBot.click()
  await expect(page.getByRole('alert')).toContainText('E2E bot roster failure')
  await expect(addBot).toBeEnabled()
  await capture(page, `lobby-bot-${scenario.screenshot}-error-1440x900`)
  await page.unrouteAll({ behavior: 'wait' })

  await addBot.click()
  await expect(page.getByText('Бот · лёгкий', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Убрать' })).toBeVisible()
  await expect(page.getByText('Готовы: 1/2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать игру' })).toBeDisabled()
  await capture(page, `lobby-bot-${scenario.screenshot}-1440x900`)
  await expectNoHorizontalOverflow(page)

  await page.keyboard.press('Tab')
  await expect(page.locator(':focus-visible')).toHaveCount(1)
  await capture(page, `lobby-bot-${scenario.screenshot}-keyboard-1440x900`)
  for (const [width, height, name] of [
    [1024, 768, `lobby-bot-${scenario.screenshot}-1024x768`],
    [390, 844, `lobby-bot-${scenario.screenshot}-390x844`],
  ] as const) {
    await page.setViewportSize({ width, height })
    const botLabel = page.getByText(initialBotLabel, { exact: true })
    await expect(botLabel).toBeVisible()
    await expectNoHorizontalOverflow(page)
    if (width === 390) await botLabel.scrollIntoViewIfNeeded()
    await capture(page, name)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  if (scenario.difficulty === 'hard') {
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()
    const difficulty = page.getByLabel('Сложность бота в слоте 2')
    let failedPatch = false
    await page.route('**/api/rooms/*/bots/*', async (route) => {
      if (route.request().method() === 'PATCH' && !failedPatch) {
        failedPatch = true
        await route.fulfill({
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'E2E bot difficulty failure' } }),
          contentType: 'application/json',
          status: 500,
        })
        return
      }
      await route.continue()
    })
    await difficulty.focus()
    await expect(difficulty).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Убрать' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(difficulty).toBeFocused()
    await difficulty.selectOption('hard')
    await expect(page.getByRole('alert')).toContainText('E2E bot difficulty failure')
    await expect(difficulty).toHaveValue('easy')
    await expect(difficulty).toBeFocused()
    await difficulty.selectOption('hard')
    await expect(difficulty).toHaveValue('hard')
    await expect(page.getByText(scenario.label, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByText('Готовы: 1/2')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeDisabled()
    await page.unrouteAll({ behavior: 'wait' })
    await page.reload()
    await expect(page.getByLabel('Сложность бота в слоте 2')).toHaveValue('hard')
    await expect(page.getByText(scenario.label, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  }
  await page.getByRole('button', { name: 'Готов', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()
  await page.getByRole('button', { name: 'Начать игру' }).click()
  await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
  const tenderId = page.url().match(/\/tenders\/([0-9a-f-]{36})$/)?.[1]
  if (!tenderId) throw new Error('Tender id is missing from the started room URL')
  const initialViewResponse = await page.request.get(`${session.apiOrigin}/api/tenders/${tenderId}`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, [gameContractVersionHeader]: '2' },
  })
  expect(initialViewResponse.ok()).toBe(true)
  const initialView = await initialViewResponse.json() as { players: Array<{ bot?: unknown; playerId: string }>; version: number }
  const humanPlayerId = initialView.players.find((player) => !player.bot)?.playerId
  if (!humanPlayerId) throw new Error('Tender view has no human participant')
  await expect(page.getByText(scenario.label, { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: '1. Выбор слота доступа' })).toBeVisible()
  await expect(page.getByText('На связи', { exact: true })).toBeVisible()

  if (scenario.difficulty === 'easy') {
    await page.context().setOffline(true)
    await sendHumanCommand(page.request, session.apiOrigin, session.accessToken, tenderId, {
      actorId: humanPlayerId,
      slot: 6,
      type: 'request-access-slot',
    })
    await expect.poll(async () => {
      const response = await page.request.get(`${session.apiOrigin}/api/tenders/${tenderId}`, {
        headers: { Authorization: `Bearer ${session.accessToken}`, [gameContractVersionHeader]: '2' },
      })
      expect(response.ok()).toBe(true)
      return tenderViewSchema.parse(await response.json()).version
    }, { intervals: [1_000], timeout: 30_000 }).toBeGreaterThan(initialView.version)
    await page.context().setOffline(false)
  } else {
    await sendHumanCommand(page.request, session.apiOrigin, session.accessToken, tenderId, {
      actorId: humanPlayerId,
      slot: 6,
      type: 'request-access-slot',
    })
  }
  await expect(page.getByRole('heading', { name: '2. Распределение мощности' })).toBeVisible({ timeout: 30_000 })
  await capture(page, `tender-bot-${scenario.screenshot}-1440x900`)
  await expectNoHorizontalOverflow(page)

  for (const [width, height, name] of [
    [1024, 768, `tender-bot-${scenario.screenshot}-1024x768`],
    [390, 844, `tender-bot-${scenario.screenshot}-390x844`],
  ] as const) {
    await page.setViewportSize({ width, height })
    await expect(page.getByText(scenario.label, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await capture(page, name)
  }

  const observedRounds = new Set<number>()
  await expect.poll(async () => {
    const response = await page.request.get(`${session.apiOrigin}/api/tenders/${tenderId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}`, [gameContractVersionHeader]: '2' },
    })
    expect(response.status()).toBe(200)
    const view = tenderViewSchema.parse(await response.json())
    observedRounds.add(view.round)
    if (view.phase === 'complete') return true
    const human = view.players.find((player) => player.playerId === humanPlayerId)!
    const base = { actorId: humanPlayerId }
    if (view.phase === 'access-slot-selection' && human.requestedAccessSlot === undefined) {
      await sendHumanCommand(page.request, session.apiOrigin, session.accessToken, tenderId, {
        ...base, type: 'request-access-slot', slot: 6,
      })
    }
    if (view.phase === 'power-allocation' && !human.powerAllocationConfirmed) {
      // A legal human choice; every research/action below must be performed by the real worker.
      await sendHumanCommand(page.request, session.apiOrigin, session.accessToken, tenderId, {
        ...base, type: 'allocate-power',
        allocation: { reconnaissance: 0, laboratory: 0, modelAnalysis: 0, contracts: 0, reserve: 4 },
      })
    }
    if (view.phase === 'final-scientific-model' && !human.finalScientificModelSubmitted) {
      await sendHumanCommand(page.request, session.apiOrigin, session.accessToken, tenderId, {
        ...base, type: 'submit-scientific-model',
        scientificModel: { signals: { [view.knownSignals[0]!]: scenario.mode === 'simple' ? { fieldType: 'inertial', polarity: 'positive' } : { fieldType: 'inertial' } } },
      })
    }
    return false
  }, { timeout: 120_000, intervals: [1_000] }).toBe(true)
  expect([...observedRounds].sort()).toEqual(Array.from({ length: scenario.rounds }, (_, index) => index + 1))
  await expect(page.locator('#completed-tender-heading')).toBeVisible()
  await capture(page, `completed-bot-${scenario.screenshot}-390x844`)
  await page.goto('/')
  await page.getByRole('button', { name: 'ИСТОРИЯ МАТЧЕЙ' }).click()
  await expect(page.getByRole('table')).toContainText(scenario.label)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('два игрока и бот завершают простую партию', async ({ browser, page }) => {
  test.setTimeout(180_000)
  const host = await registerWithAccessToken(page)
  const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const guestPage = await guestContext.newPage()
  try {
    const guest = await registerWithAccessToken(guestPage)
    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Режим игры').selectOption('simple')
    await dialog.getByLabel('Количество игроков').selectOption('3')
    await dialog.getByRole('checkbox', { name: 'Возможность добавить ботов' }).check()
    await dialog.getByRole('button', { name: 'Создать команду' }).click()
    const code = (await page.getByTestId('room-join-code').textContent())?.trim()
    if (!code) throw new Error('Нет кода комнаты')
    await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
    await guestPage.getByLabel('Код комнаты').fill(code)
    await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    await expect(page.getByRole('button', { name: 'Добавить лёгкого бота' })).toHaveCount(1)
    await page.getByRole('button', { name: 'Добавить лёгкого бота' }).click()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await page.getByRole('button', { name: 'Начать игру' }).click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
    const tenderId = page.url().split('/').at(-1)!
    const read = async (session: typeof host) => {
      const response = await page.request.get(`${session.apiOrigin}/api/tenders/${tenderId}`, {
        headers: { Authorization: `Bearer ${session.accessToken}`, [gameContractVersionHeader]: '2' },
      })
      expect(response.ok()).toBe(true)
      return tenderViewSchema.parse(await response.json())
    }
    const initial = await read(host)
    expect(initial.players.filter((player) => !player.bot)).toHaveLength(2)
    expect(initial.players.filter((player) => player.bot)).toHaveLength(1)
    const rounds = new Set<number>()
    await expect.poll(async () => {
      const view = await read(host)
      rounds.add(view.round)
      if (view.phase === 'complete') return true
      for (const session of [host, guest]) {
        const current = await read(session)
        const human = current.players.find((player) => player.playerId === session.id)!
        let command: Record<string, unknown> | undefined
        if (current.phase === 'access-slot-selection' && human.requestedAccessSlot === undefined)
          command = { type: 'request-access-slot', slot: 6 }
        if (current.phase === 'power-allocation' && !human.powerAllocationConfirmed)
          command = { type: 'allocate-power', allocation: { reconnaissance: 0, laboratory: 0, modelAnalysis: 0, contracts: 0, reserve: 4 } }
        if (current.phase === 'final-scientific-model' && !human.finalScientificModelSubmitted)
          command = { type: 'submit-scientific-model', scientificModel: { signals: { [current.knownSignals[0]!]: { fieldType: 'inertial', polarity: 'positive' } } } }
        if (command) await sendHumanCommand(page.request, session.apiOrigin, session.accessToken, tenderId, { ...command, actorId: session.id })
      }
      return false
    }, { timeout: 120_000, intervals: [1_000] }).toBe(true)
    expect([...rounds].sort()).toEqual([1, 2, 3])
    await expect(page.locator('#completed-tender-heading')).toBeVisible()
    await expect(guestPage.locator('#completed-tender-heading')).toBeVisible()
  } finally {
    await guestContext.close()
  }
})

test('host can manage three bots without losing mobile selector access', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerWithAccessToken(page)

  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Количество игроков').selectOption('4')
  await dialog.getByRole('checkbox', { name: 'Возможность добавить ботов' }).check()
  await dialog.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page.getByRole('heading', { name: 'Лобби' })).toBeVisible()

  for (let count = 0; count < 3; count += 1) {
    await page.getByRole('button', { name: 'Добавить лёгкого бота' }).first().click()
  }
  await expect(page.getByText('Бот · лёгкий', { exact: true })).toHaveCount(3)
  const explanation = 'Лёгкий выясняет конфигурацию аномалии. Сложный старается набрать больше очков.'
  await expect(page.getByText(explanation, { exact: true })).toBeVisible()
  const thirdBotDifficulty = page.getByLabel('Сложность бота в слоте 3')
  await expect(thirdBotDifficulty).toHaveAccessibleDescription(explanation)
  await thirdBotDifficulty.selectOption('hard')
  await expect(page.getByText('Бот · сложный', { exact: true })).toBeVisible()
  await capture(page, 'lobby-three-bots-1440x900')

  await page.setViewportSize({ width: 390, height: 844 })
  for (const seat of [2, 3, 4]) {
    const selector = page.getByLabel(`Сложность бота в слоте ${seat}`)
    await selector.scrollIntoViewIfNeeded()
    await expect(selector).toBeVisible()
  }
  await expectNoHorizontalOverflow(page)
  await capture(page, 'lobby-three-bots-390x844')

  const remove = page.getByRole('button', { name: 'Убрать' }).last()
  await remove.focus()
  await expect(remove).toBeFocused()
  await remove.click()
  const addFourthBot = page.locator('[data-add-bot-seat="4"]')
  await expect(addFourthBot).toBeFocused()
  await addFourthBot.press('Enter')
  const fourthBotDifficulty = page.getByLabel('Сложность бота в слоте 4')
  await expect(fourthBotDifficulty).toBeVisible()
  await expect(fourthBotDifficulty).toBeFocused()
})
