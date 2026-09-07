import { randomUUID } from 'node:crypto'
import { tenderViewSchema } from '@anomaly-detector/contracts'

import { expect, registerBrowserUser, test } from '../helpers/test'

type Session = { accessToken: string; apiOrigin: string; playerId: string }

async function register(page: Parameters<typeof registerBrowserUser>[0], name: string, prefix: string): Promise<Session> {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/auth/register')
  await registerBrowserUser(page, name, prefix)
  const response = await responsePromise
  const body = await response.json() as { accessToken?: string; user?: { id?: string } }
  if (!response.ok() || !body.accessToken || !body.user?.id) throw new Error('Registration response lacks session data')
  return { accessToken: body.accessToken, apiOrigin: new URL(response.url()).origin, playerId: body.user.id }
}

async function command(page: Parameters<typeof registerBrowserUser>[0], session: Session, tenderId: string, payload: Record<string, unknown>) {
  const response = await page.request.post(`${session.apiOrigin}/api/tenders/${tenderId}/commands`, {
    data: { ...payload, actorId: session.playerId, commandId: randomUUID(), tenderId },
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
  if (!response.ok()) {
    const body = await response.json() as { error?: { code?: string } }
    // A simultaneous bot commit is an expected optimistic conflict. The next
    // poll reads fresh participant views and chooses a new legal human action.
    if (response.status() === 409 && body.error?.code === 'TENDER_VERSION_CONFLICT') return
    throw new Error(`Mixed human command ${String(payload.type)} failed ${response.status()}: ${JSON.stringify(body)}`)
  }
}

async function readTender(page: Parameters<typeof registerBrowserUser>[0], session: Session, tenderId: string) {
  const response = await page.request.get(`${session.apiOrigin}/api/tenders/${tenderId}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<{ phase: string; round: number; players: Array<{ bot?: { difficulty: 'easy' | 'hard' }; playerId: string }> }>
}

test('two humans complete a mixed easy and hard bot Tender', async ({ browser, page }) => {
  test.setTimeout(300_000)
  const owner = await register(page, 'Владелец mixed E2E', 'mixed-owner')
  const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const guestPage = await guestContext.newPage()
  const guest = await register(guestPage, 'Гость mixed E2E', 'mixed-guest')

  // Create capacity 4 with bots enabled; guest joins by code.
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await page.getByLabel('Количество игроков').selectOption('4')
  await page.getByRole('checkbox', { name: 'Возможность добавить ботов' }).check()
  await page.getByRole('button', { name: 'Создать команду' }).click()
  const code = await page.getByTestId('room-join-code').textContent()
  if (!code) throw new Error('Room code missing')
  await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
  await guestPage.getByLabel('Код комнаты').fill(code)
  await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
  await expect(guestPage).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Гость mixed E2E', { exact: true })).toBeVisible()

  // The owner deliberately fills seats 3 and 4. #51 selector changes only bot 4.
  await page.getByRole('button', { name: 'Добавить лёгкого бота' }).nth(0).click()
  await page.getByRole('button', { name: 'Добавить лёгкого бота' }).nth(0).click()
  await page.getByLabel('Сложность бота в слоте 4').selectOption('hard')
  await expect(guestPage.getByText('Бот · лёгкий', { exact: true })).toBeVisible()
  await expect(guestPage.getByText('Бот · сложный', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Готов', exact: true }).click()
  await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()
  await page.getByRole('button', { name: 'Начать игру' }).click()
  await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
  const tenderId = page.url().match(/\/tenders\/([0-9a-f-]{36})$/)?.[1]
  if (!tenderId) throw new Error('Tender id missing')

  const ownerView = await readTender(page, owner, tenderId)
  const guestView = await readTender(guestPage, guest, tenderId)
  expect(ownerView.players.filter((player) => player.bot).map((player) => player.bot!.difficulty).sort()).toEqual(['easy', 'hard'])
  expect(guestView.players).toHaveLength(4)
  expect(guestView.players.map(({ playerId, bot }) => ({ playerId, bot })))
    .toEqual(ownerView.players.map(({ playerId, bot }) => ({ playerId, bot })))

  const observedRounds = new Set<number>()
  await expect.poll(async () => {
    const views = await Promise.all([readTender(page, owner, tenderId), readTender(guestPage, guest, tenderId)])
    const parsed = views.map((view) => tenderViewSchema.parse(view))
    observedRounds.add(parsed[0]!.round)
    if (parsed.every((view) => view.phase === 'complete')) {
      expect(parsed[0]!.winnerPlayerIds).toEqual(parsed[1]!.winnerPlayerIds)
      expect(parsed[0]!.audit?.ratingBreakdownByPlayer).toEqual(parsed[1]!.audit?.ratingBreakdownByPlayer)
      return true
    }

    for (const [session, view, driverPage] of [[owner, parsed[0]!, page], [guest, parsed[1]!, guestPage]] as const) {
      const human = view.players.find((player) => player.playerId === session.playerId)
      if (!human) throw new Error('Authenticated human is missing from its Tender view')
      if (view.phase === 'access-slot-selection' && human.requestedAccessSlot === undefined) {
        await command(driverPage, session, tenderId, { actorId: session.playerId, slot: 6, type: 'request-access-slot' })
      } else if (view.phase === 'power-allocation' && !human.powerAllocationConfirmed) {
        await command(driverPage, session, tenderId, {
          actorId: session.playerId,
          allocation: { reconnaissance: 0, laboratory: 0, modelAnalysis: 0, contracts: 0, reserve: 4 },
          type: 'allocate-power',
        })
      } else if (view.phase === 'final-scientific-model' && !human.finalScientificModelSubmitted) {
        const signal = view.knownSignals[0]
        if (!signal) throw new Error('Final Tender view has no known signal for the legal baseline model')
        await command(driverPage, session, tenderId, {
          actorId: session.playerId,
          scientificModel: { signals: { [signal]: { fieldType: 'inertial' } } },
          type: 'submit-scientific-model',
        })
      }
    }
    return false
  }, { intervals: [1_000], timeout: 120_000 }).toBe(true)
  expect([...observedRounds].sort()).toEqual([1, 2, 3, 4, 5])
  await expect(page.locator('#completed-tender-heading')).toBeVisible()
  await expect(guestPage.locator('#completed-tender-heading')).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: 'ИСТОРИЯ МАТЧЕЙ' }).click()
  await expect(page.getByRole('table')).toContainText('Бот · лёгкий')
  await expect(page.getByRole('table')).toContainText('Бот · сложный')

  await guestPage.goto('/')
  await guestPage.getByRole('button', { name: 'ИСТОРИЯ МАТЧЕЙ' }).click()
  await expect(guestPage.getByRole('table')).toContainText('Бот · лёгкий')
  await expect(guestPage.getByRole('table')).toContainText('Бот · сложный')
  await guestContext.close()
})
