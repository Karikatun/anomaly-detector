import type { Locator, Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, registerBrowserUser, test } from '../helpers/test'

const uxAuditDirectory = process.env.UX_AUDIT_DIR

type AxeFinding = {
  id: string
  impact: string | null
  targets: string[][]
  helpUrl: string
}

async function auditCheckpoint(page: Page, name: string) {
  if (!uxAuditDirectory) return

  const outputDirectory = resolve(uxAuditDirectory)
  await mkdir(outputDirectory, { recursive: true })
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
  }))
  const agentation = page.locator('[data-agentation-root]')
  await agentation.evaluateAll((elements) => {
    for (const element of elements) {
      if (element instanceof HTMLElement) element.hidden = true
    }
  })
  await page.screenshot({ path: resolve(outputDirectory, `${name}.viewport.png`) })
  await page.screenshot({ path: resolve(outputDirectory, `${name}.full.png`), fullPage: true })

  const axe = await new AxeBuilder({ page })
    .exclude('[data-agentation-root]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const findings: AxeFinding[] = axe.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
    helpUrl: violation.helpUrl,
  }))
  await writeFile(
    resolve(outputDirectory, `${name}.axe.json`),
    `${JSON.stringify(findings, null, 2)}\n`,
  )
  const smallTargets = await page.locator('button, select, input, summary, a[href]').evaluateAll((elements) => elements
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return !element.closest('[data-agentation-root]')
        && !(element instanceof HTMLButtonElement && element.disabled)
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < innerWidth
        && rect.top < innerHeight
        && (rect.width < 24 || rect.height < 24)
    })
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        name: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ') || element.tagName,
        selector: element.tagName.toLowerCase(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }))
  await writeFile(
    resolve(outputDirectory, `${name}.touch.json`),
    `${JSON.stringify(smallTargets, null, 2)}\n`,
  )

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (process.env.UX_AUDIT_ASSERT_AXE === '1') expect(findings).toEqual([])
}

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

async function expectFullyInViewport(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 0
      && rect.left >= 0
      && rect.bottom <= window.innerHeight
      && rect.right <= window.innerWidth
      && element.scrollWidth <= element.clientWidth
      && element.scrollHeight <= element.clientHeight
  })).toBe(true)
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
  if (signalCount > 1) {
    const firstTarget = targets.first()
    await firstTarget.click()
    await expect(firstTarget).toHaveAttribute('aria-pressed', 'true')
    await firstTarget.click()
    await expect(firstTarget).toHaveAttribute('aria-pressed', 'false')
    await firstTarget.press('Enter')
    await expect(firstTarget).toHaveAttribute('aria-pressed', 'true')
  }
  for (let index = signalCount > 1 ? 1 : 0; index < signalCount; index += 1) {
    await targets.nth(index).click()
    await expect(targets.nth(index)).toHaveAttribute('aria-pressed', 'true')
  }
  if (signalCount > 1 && await targets.count() > signalCount) {
    await expect(targets.nth(signalCount)).toBeDisabled()
  }
  await page.getByRole('button', { name: 'Исследовать' }).click()
}

async function selectLaboratoryPair(page: Page, pairIndex = 0) {
  const samples = page.getByRole('button', { name: /^Образец:/ })
  const sampleCount = await samples.count()
  const sourceIndex = Math.floor(pairIndex / Math.max(1, sampleCount - 1)) % sampleCount
  const receiverIndex = pairIndex % Math.max(1, sampleCount - 1)
  await samples.nth(sourceIndex).click()
  await expect(page.getByRole('button', { name: /^Источник:/ })).toHaveCount(1)
  await page.getByRole('button', { name: /^Образец:/ }).nth(receiverIndex).click()
  await expect(page.getByRole('button', { name: /^Приёмник:/ })).toHaveCount(1)
}

async function runLaboratory(page: Page, mode: 'broad' | 'deep' = 'deep', pairIndex = 0) {
  const modeButton = page.getByRole('button', {
    name: mode === 'broad' ? /^Широкое/ : /^Глубокое/,
  })
  if (await modeButton.isVisible()) await modeButton.click()

  if (mode === 'broad') {
    await selectLaboratoryPair(page, pairIndex)
    await expect(page.getByRole('button', { name: /^Глубокое/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /^Источник:/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Приёмник:/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Сохранить первую пару' })).toBeEnabled()
    await page.getByRole('button', { name: 'Сохранить первую пару' }).click()
    await selectLaboratoryPair(page, pairIndex + 1)
    const confirmButton = page.getByRole('button', { name: 'Провести два опыта' })
    await confirmButton.click()
    await expectLaboratoryCommandAccepted(page, confirmButton)
    await expect(page.getByText(/^Вы уже исследовали .*направленную пару/)).toHaveCount(0)
    return
  }
  await selectLaboratoryPair(page, pairIndex)
  const confirmButton = page.getByRole('button', { name: /^Провести опыт:/ })
  await confirmButton.click()
  await expectLaboratoryCommandAccepted(page, confirmButton)
  await expect(page.getByText(/^Вы уже исследовали .*направленную пару/)).toHaveCount(0)
}

async function expectLaboratoryCommandAccepted(page: Page, confirmButton: ReturnType<Page['getByRole']>) {
  await expect.poll(async () => {
    const isWaiting = await page.getByText('Ожидание хода', { exact: true }).count() > 0
    return isWaiting || await confirmButton.count() === 0
  }).toBe(true)
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

    await page.getByRole('button', { name: 'Справка' }).click()
    const helpDialog = page.getByRole('dialog', { name: 'Справка' })
    await helpDialog.getByRole('button', { name: 'Трактовка анализов' }).click()
    const laboratoryDialog = page.getByRole('dialog', { name: 'Трактовка лабораторных анализов' })
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

    const workingModelTrigger = page.getByRole('button', { name: /Рабочая модель/ })
    await workingModelTrigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)

    await expect(sharedTimer).toBeVisible()
    await expect(dialog.locator('[role="timer"]')).toHaveCount(0)
    await expect.poll(() => sharedTimer.textContent()).not.toBe(initialTime)

    const headerBox = await stickyHeader.boundingBox()
    const dialogBox = await dialog.boundingBox()
    expect(headerBox).not.toBeNull()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)

    const fieldButton = dialog.getByRole('button', {
      name: /: гипотеза, тип поля Инерционное$/,
    }).first()
    await expect(fieldButton).toBeEnabled()
    await fieldButton.click()
    await expect(fieldButton).toHaveAttribute('aria-pressed', 'true')
    await fieldButton.click()
    await expect(fieldButton).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(workingModelTrigger).toBeFocused()
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
      name: /: гипотеза, полярность Положительная$/,
    }).first().click()
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
    await page.setViewportSize({ width: 390, height: 844 })
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
  const confirm = page.getByRole('button', { name: /^Подтвердить контракт: / }).first()
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
  await expect.poll(async () =>
    await selectedContractCard.getByText('Контракт выполнен', { exact: true }).isVisible()
    || !await page.getByRole('heading', { name: headings.contracts }).isVisible(),
  ).toBe(true)
  await expect(page.getByRole('button', { name: /^Подтвердить контракт: / })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Подходящее исследование|Подходящая сертификация|Дополнительное исследование/ })).toHaveCount(0)
}

async function completeAndSubmitFinalModel(page: Page) {
  for (const signal of ['Aster', 'Boreal', 'Cinder', 'Delta', 'Eclipse', 'Ferro']) {
    const fieldTypeSelect = page.getByRole('combobox', { name: `${signal}: тип поля`, exact: true })
    const polaritySelect = page.getByRole('combobox', { name: `${signal}: полярность`, exact: true })
    if (await fieldTypeSelect.isVisible()) {
      if (await fieldTypeSelect.inputValue() === '') await fieldTypeSelect.selectOption({ index: 1 })
      if (await polaritySelect.inputValue() === '') await polaritySelect.selectOption({ index: 1 })
    } else {
      const fieldTypes = page.getByRole('button', { name: new RegExp(`^${signal}: тип поля `) })
      if (!await fieldTypes.evaluateAll((buttons) => buttons.some((button) => button.getAttribute('aria-pressed') === 'true'))) {
        await fieldTypes.first().click()
      }
      const polarities = page.getByRole('button', { name: new RegExp(`^${signal}: полярность `) })
      if (!await polarities.evaluateAll((buttons) => buttons.some((button) => button.getAttribute('aria-pressed') === 'true'))) {
        await polarities.first().click()
      }
    }
  }
  await expect(page.getByLabel('Заполнено параметров: 12 из 12')).toBeVisible()
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

test('keeps a four-player completed leaderboard compact after an early finish', async ({ browser, page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Хост 4P E2E', 'four-player-host')
  const webOrigin = new URL(page.url()).origin
  const guestSpecs = [
    ['Исследователь с очень длинным корпоративным именем', 'four-player-guest-one'],
    ['Гость 4P Бета', 'four-player-guest-two'],
    ['Гость 4P Гамма', 'four-player-guest-three'],
  ] as const
  const guestContexts = await Promise.all(guestSpecs.map(() => browser.newContext({ baseURL: webOrigin })))
  const guestPages = await Promise.all(guestContexts.map((context) => context.newPage()))

  try {
    for (let index = 0; index < guestPages.length; index += 1) {
      await registerBrowserUser(guestPages[index]!, guestSpecs[index]![0], guestSpecs[index]![1], webOrigin)
    }

    await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
    await page.getByLabel('Количество игроков').selectOption('4')
    await page.getByRole('button', { name: 'Создать команду' }).click()
    const roomJoinCode = await readRoomJoinCode(page)

    for (const guestPage of guestPages) {
      await guestPage.getByRole('button', { name: 'ВОЙТИ ПО КОДУ' }).click()
      await guestPage.getByLabel('Код комнаты').fill(roomJoinCode)
      await guestPage.getByRole('button', { name: 'Войти по коду' }).click()
    }
    for (let index = 0; index < guestPages.length; index += 1) {
      const guestPage = guestPages[index]!
      await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
      await expect(page.getByText(`Готовы: ${index + 1}/4`)).toBeVisible()
    }
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByText('Экипаж готов.')).toBeVisible()
    const startButton = page.getByRole('button', { name: 'Начать игру' })
    await expect(startButton).toBeEnabled()
    await startButton.click()
    await expect(page).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)

    for (const guestPage of guestPages) {
      await expect(guestPage).toHaveURL(/\/tenders\/[0-9a-f-]{36}$/)
      await guestPage.getByRole('button', { name: 'Выйти из матча' }).click()
      await guestPage.getByRole('dialog', { name: 'Что сделать с матчем?' })
        .getByRole('button', { name: 'Выйти', exact: true }).click()
      await expect(guestPage).toHaveURL('/')
    }

    await expect(page.getByRole('heading', { name: 'Тендер завершён' })).toBeVisible()
    await expect(page.getByText('Вы победили', { exact: true })).toBeVisible()
    const ranking = page.locator('details[data-audit-section="ranking"]')
    await expect(ranking.locator('ol > li')).toHaveCount(4)
    await expect(ranking.getByText('Исследователь с очен', { exact: true })).toBeVisible()
    await auditCheckpoint(page, '14-completed-audit-four-player-desktop-1440x900')

    await page.setViewportSize({ width: 360, height: 800 })
    const rankingSummary = ranking.locator(':scope > summary')
    await expect(rankingSummary).toContainText('4 участника')
    await rankingSummary.press('Enter')
    await expect(ranking.locator('ol > li')).toHaveCount(4)
    await auditCheckpoint(page, '15-completed-audit-four-player-mobile-360x800')
    await page.setViewportSize({ width: 320, height: 720 })
    await auditCheckpoint(page, '16-completed-audit-four-player-mobile-320x720')
  } finally {
    await Promise.all(guestContexts.map((context) => context.close()))
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
    const helpButton = page.getByRole('button', { name: 'Справка' })
    const [leaveBox, helpBox] = await Promise.all([
      leaveButton.boundingBox(),
      helpButton.boundingBox(),
    ])
    expect(leaveBox).not.toBeNull()
    expect(helpBox).not.toBeNull()
    expect(leaveBox!.y).toBeLessThan(helpBox!.y)
    expect(await tenderHeader.evaluate((header) => header.scrollWidth <= header.clientWidth)).toBe(true)
    await helpButton.click()
    const helpDialog = page.getByRole('dialog', { name: 'Справка' })
    await expect(helpDialog.getByRole('button', { name: 'Правила игры' })).toBeVisible()
    await expect(helpDialog.getByRole('button', { name: 'Трактовка анализов' })).toBeVisible()
    await helpDialog.getByRole('button', { name: 'Правила игры' }).click()
    const mobileRulesDialog = page.getByRole('dialog', { name: 'Справочник правил' })
    await expect(mobileRulesDialog).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await expect(mobileRulesDialog).toBeHidden()

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Правила', exact: true }).click()
    const rulesDialog = page.getByRole('dialog')
    await expect(rulesDialog).toBeVisible()
    expect(await rulesDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
    const timerWarning = rulesDialog.getByRole('status')
    const rulesetNotice = rulesDialog.getByText(/^Этот Тендер использует/)
    const firstRule = rulesDialog.getByRole('button', { name: 'Детальные правила по фазам' })
    await expect(firstRule).toBeVisible()
    const [dialogBox, timerWarningBox, rulesetNoticeBox, firstRuleBox] = await Promise.all([
      rulesDialog.boundingBox(),
      timerWarning.boundingBox(),
      rulesetNotice.boundingBox(),
      firstRule.boundingBox(),
    ])
    expect(dialogBox).not.toBeNull()
    expect(timerWarningBox).not.toBeNull()
    expect(rulesetNoticeBox).not.toBeNull()
    expect(firstRuleBox).not.toBeNull()
    expect(timerWarningBox!.y + timerWarningBox!.height).toBeLessThanOrEqual(firstRuleBox!.y)
    expect(rulesetNoticeBox!.x).toBeGreaterThanOrEqual(timerWarningBox!.x)
    expect(rulesetNoticeBox!.x + rulesetNoticeBox!.width).toBeLessThanOrEqual(
      timerWarningBox!.x + timerWarningBox!.width,
    )
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
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Хост E2E', 'room-host')
  const webOrigin = new URL(page.url()).origin

  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(
    page.getByText('Сыграно матчей').locator('..').getByText('0', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()

  const guestContext = await browser.newContext({
    baseURL: webOrigin,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  })
  const guestPage = await guestContext.newPage()
  guestPage.setDefaultTimeout(15_000)
  const runtimeIssues: string[] = []
  const collectRuntimeIssues = (source: string) => {
    const currentPage = source === 'host' ? page : guestPage
    currentPage.on('pageerror', (error) => runtimeIssues.push(`${source}: pageerror: ${error.message}`))
    currentPage.on('console', (message) => {
      if (message.type() !== 'error') return
      const resourceUrl = message.location().url
      const expectedInjectedFailure = resourceUrl.endsWith('/api/auth/refresh')
        || /\/api\/tenders\/[0-9a-f-]+\/commands$/.test(resourceUrl)
      if (!expectedInjectedFailure) runtimeIssues.push(`${source}: console: ${message.text()}`)
    })
    currentPage.on('requestfailed', (request) => {
      runtimeIssues.push(`${source}: requestfailed: ${request.method()} ${new URL(request.url()).pathname}`)
    })
  }
  collectRuntimeIssues('host')
  collectRuntimeIssues('guest')
  const guestRealtimeViews: Array<Record<string, unknown>> = []
  guestPage.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload)) as {
          type?: string
          view?: Record<string, unknown>
        }
        if (message.type === 'tender-view' && message.view) {
          guestRealtimeViews.push(message.view)
        }
      } catch {
        // Only Tender JSON frames participate in the privacy assertion.
      }
    })
  })
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
    await expect(page.getByRole('button', { name: /^Данные исследований/ })).toBeVisible()
    await expect(page.getByText('Хост E2E → Гость E2E', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', {
      name: 'Слот доступа 5: Ночной. Порядок действия: 5. Компенсация: 1 образец сигнала',
    })).toBeVisible()
    await expect(page.getByRole('button', {
      name: 'Слот доступа 6: Удалённый. Порядок действия: 6. Компенсация: 1 бюджет и 1 образец сигнала',
    })).toBeVisible()
    await auditCheckpoint(page, '01-access-slot-desktop-1440x900')
    await auditCheckpoint(guestPage, '02-access-slot-mobile-390x844')

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
    await page.setViewportSize({ width: 1024, height: 768 })
    await auditCheckpoint(page, '03-power-compact-1024x768')
    await auditCheckpoint(guestPage, '03b-power-mobile-390x844')
    await page.setViewportSize({ width: 1440, height: 900 })
    await allocatePower(page, { 'Разведка': 2, 'Лаборатория': 1, 'Контракты': 1 })
    await allocatePower(guestPage, { 'Разведка': 2, 'Лаборатория': 1, 'Контракты': 1 })

    await expectPhase(page, headings.reconnaissance)
    await expect(page.getByRole('button', { name: /^Контракты этого раунда · \d+$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Правила' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Трактовка анализов' })).toBeDisabled()
    await runReconnaissance(page)
    await expect(page.getByText('Образцы: 2 / 6')).toBeVisible()
    await expect(page.getByText('Изучено', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Правила' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Трактовка анализов' })).toBeEnabled()
    await auditCheckpoint(page, '04-reconnaissance-desktop-1440x900')
    await expectPhase(guestPage, headings.reconnaissance)
    await expect(guestPage.getByRole('button', { name: /^Контракты этого раунда · \d+$/ })).toBeVisible()
    await runReconnaissance(guestPage)

    await expectPhase(page, headings.laboratory)
    await runLaboratory(page, 'deep', 0)
    await expectPhase(guestPage, headings.laboratory)
    await runLaboratory(guestPage, 'deep', 0)

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
      const researchButton = page.getByRole('button', { name: /^Данные исследований/ })
      await expect(researchButton).toBeVisible()
      if (round > 2) {
        await researchButton.click()
        const researchDialog = page.getByRole('dialog')
        await expect(researchDialog.locator('[data-private-thesis]')).toHaveCount(round - 2)
        await page.getByRole('button', { name: 'Закрыть данные исследований' }).click()
      }
      await chooseAccessSlot(page, 1)
      await chooseAccessSlot(guestPage, 2)

      await expectPhase(page, headings.power)
      await expectPhase(guestPage, headings.power)
      const roundAllocation = round === 2
        ? { 'Разведка': 1, 'Лаборатория': 2, 'Анализ модели': 1 }
        : { 'Лаборатория': 2, 'Анализ модели': 1, 'Контракты': 1 }
      await allocatePower(page, roundAllocation)
      await allocatePower(guestPage, roundAllocation)

      if (round === 2) {
        await expectPhase(page, headings.reconnaissance)
        await runReconnaissance(page, 1)
        await expectPhase(guestPage, headings.reconnaissance)
        await runReconnaissance(guestPage, 1)
      }

      await expectPhase(page, headings.laboratory)
      await expectPhase(guestPage, headings.laboratory)
      if (round === 2) {
        await expect(page.getByText('Шаг 1 из 2 · выберите тип исследования')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Сначала выберите тип исследования' })).toBeDisabled()
        await expect(page.getByLabel('Образец: Aster')).toBeDisabled()
        await auditCheckpoint(page, '05-laboratory-desktop-1440x900')
        await auditCheckpoint(guestPage, '06-laboratory-mobile-390x844')
      }
      await runLaboratory(page, 'deep', round - 1)
      await expect(page.getByText('История', { exact: true })).toBeVisible()
      await runLaboratory(guestPage, round === 2 ? 'broad' : 'deep', round === 2 ? 1 : round)

      await expectPhase(page, headings.analysis)
      await expectPhase(guestPage, headings.analysis)
      if (round === 2) {
        await page.reload()
        await expectPhase(page, headings.analysis)
      }
      await expect(guestPage.getByText('История лаборатории')).toHaveCount(0)
      await expect(guestPage.getByRole('button', { name: /^Данные исследований/ })).toBeVisible()
      if (round === 2) {
        const mobileActionFooter = guestPage
          .getByRole('button', { name: 'Выдвинуть тезис' })
          .locator('xpath=ancestor::footer')
        await expect(mobileActionFooter).not.toHaveCSS('position', 'fixed')
      }
      if (round > 2) {
        const previousThesisCount = round - 2
        const thesisHistory = page
          .getByText('История тезисов', { exact: true })
          .locator('..')
          .locator('..')
        await expect(thesisHistory.locator('[data-private-thesis]')).toHaveCount(previousThesisCount)
        await expect(page.getByText(`Всего: ${previousThesisCount} · раунд: 0/1`)).toBeVisible()
      }
      if (round === 2) await verifyWorkingModelModal(guestPage)
      if (round === 2) {
        await auditCheckpoint(page, '07-model-analysis-desktop-1440x900')
        await auditCheckpoint(guestPage, '08-model-analysis-mobile-390x844')
      }
      await submitThesis(page)
      if (round === 2) {
        await expect(guestPage.getByText('Завершили 1 из 2 исследователей').first()).toBeVisible()
        const guestViewAfterHostThesis = guestRealtimeViews
          .filter((view) => view.phase === 'model-analysis')
          .at(-1)
        expect(guestViewAfterHostThesis?.publicTheses).toEqual([])
        expect(guestViewAfterHostThesis?.privateTheses).toEqual([])
      }
      await submitThesis(guestPage)
      if (round >= 3) {
        await expectPhase(page, headings.contracts)
        if (round === 3) await auditCheckpoint(page, '09-contracts-desktop-1440x900')
        await completeContract(page)
        if (await guestPage.getByRole('heading', { name: headings.contracts }).isVisible()) {
          await completeContract(guestPage)
        }
      }
    }

    await expectPhase(page, headings.final)
    await expectPhase(guestPage, headings.final)
    const finalTimer = page.getByRole('timer', { name: 'До конца фазы' })
    await expect.poll(async () => {
      const [minutes = 0, seconds = 0] = (await finalTimer.textContent() ?? '').split(':').map(Number)
      return minutes * 60 + seconds
    }).toBeGreaterThan(170)
    await expect(page.getByRole('heading', { name: 'Игроки' })).toHaveCount(1)
    const hostResearchButton = page.getByRole('button', { name: /^Данные исследований/ })
    await expect(hostResearchButton).toBeVisible()
    await expect(page.getByText('Рабочая модель', { exact: true })).toHaveCount(0)
    await hostResearchButton.click()
    await expect(page.getByRole('dialog').locator('[data-private-thesis]')).toHaveCount(4)
    await page.getByRole('button', { name: 'Закрыть данные исследований' }).click()
    const guestResearchButton = guestPage.getByRole('button', { name: /^Данные исследований/ })
    await expect(guestResearchButton).toBeVisible()
    await guestResearchButton.click()
    await expect(guestPage.getByRole('dialog').locator('[data-private-thesis]')).toHaveCount(4)
    await guestPage.getByRole('button', { name: 'Закрыть данные исследований' }).click()
    await expect(guestPage.getByText('Подтвердили 0 из 2 исследователей').first()).toBeVisible()
    await expect(guestPage.getByRole('combobox', { name: 'Aster: тип поля', exact: true })).toBeVisible()
    await expect(guestPage.getByRole('combobox', { name: 'Aster: полярность', exact: true })).toBeVisible()
    await expect(
      guestPage.getByRole('navigation', { name: 'Прогресс фаз раунда' })
        .getByText('Этап 7 из 7 · Финальная модель', { exact: true }),
    ).toBeVisible()
    await expect(guestPage.getByRole('button', { name: 'Отправить финальную модель' })).toBeEnabled()
    await expect(
      guestPage.getByRole('button', { name: 'Отправить финальную модель' }).locator('xpath=ancestor::footer'),
    ).toHaveCSS('position', 'sticky')
    await expectFullyInViewport(page.locator('[data-tutorial-final-submit]'))
    await page.setViewportSize({ width: 1024, height: 768 })
    await expectFullyInViewport(page.locator('[data-tutorial-final-submit]'))
    await auditCheckpoint(page, '10-final-model-compact-1024x768')
    await page.setViewportSize({ width: 1440, height: 900 })
    await auditCheckpoint(page, '10-final-model-desktop-1440x900')
    await auditCheckpoint(guestPage, '11-final-model-mobile-390x844')
    const finalDraftSaved = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST' || !response.url().endsWith('/commands')) return false
      const command = response.request().postDataJSON() as { type?: string } | null
      return command?.type === 'update-scientific-model-draft' && response.ok()
    })
    await page.getByRole('button', { name: 'Ferro: тип поля Инерционное', exact: true }).click()
    await page.getByRole('button', { name: 'Ferro: полярность Положительная', exact: true }).click()
    await finalDraftSaved
    await page.reload()
    await expectPhase(page, headings.final)
    await expect(page.getByRole('button', {
      name: 'Ferro: тип поля Инерционное',
      exact: true,
    })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', {
      name: 'Ferro: полярность Положительная',
      exact: true,
    })).toHaveAttribute('aria-pressed', 'true')
    await completeAndSubmitFinalModel(page)
    await expectPhase(guestPage, headings.final)
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Финальная модель отправлена · 12/12' })).toBeDisabled()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Финальная модель отправлена · 12/12' })).toBeDisabled()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.reload()
    await expectPhase(page, headings.final)
    await expect(page.getByLabel('Заполнено параметров: 12 из 12')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Aster: тип поля / }).first()).toBeDisabled()
    await completeAndSubmitFinalModel(guestPage)
    await expect(page.getByText('Тендер завершён', { exact: true })).toBeVisible()
    await expect(guestPage.getByText('Тендер завершён', { exact: true })).toBeVisible()
    await expect(page.locator('header[aria-label="Результаты завершённого тендера"]')).toBeVisible()
    await expect(guestPage.locator('header[aria-label="Результаты завершённого тендера"]')).toBeVisible()
    await expect(guestPage.getByRole('heading', { name: /\d+ место · \d+ очк/ })).toBeVisible()
    await expect(guestPage.getByText(/Гость E2E · Слот \d/)).toBeVisible()
    await expect(guestPage.getByText('Исследование завершено', { exact: true })).toHaveCount(0)
    await expect(guestPage.locator('details[data-audit-section="own-model"] > summary')).toBeVisible()
    await expect(guestPage.locator('details[data-audit-section="other-players"] > summary')).toBeVisible()
    await expect(guestPage.locator('details[data-audit-section="own-model"] > summary')).toContainText(/\d+\/12 верно/)
    await expect(guestPage.locator('details[data-audit-section="full-audit"] > summary')).toContainText('5 раундов')
    const guestFullAudit = guestPage.locator('details[data-audit-section="full-audit"]')
    await expect(guestFullAudit).not.toHaveAttribute('open', '')
    const fullAuditSummary = guestPage.locator('details[data-audit-section="full-audit"] > summary')
    await fullAuditSummary.focus()
    await expect(fullAuditSummary).toBeFocused()
    await fullAuditSummary.press('Enter')
    await expect(guestFullAudit.getByRole('combobox', { name: 'Фильтр итогового аудита по игроку' })
      .locator('option:checked')).toHaveText('Гость E2E')
    await expect(guestFullAudit.getByRole('option', { name: 'Все игроки' })).toHaveCount(1)
    await fullAuditSummary.press('Enter')
    await expect(guestFullAudit).not.toHaveAttribute('open', '')
    await expect(page.getByRole('heading', { name: 'Итоговый рейтинг', exact: true })).toBeVisible()
    await expect(page.getByText('Подробнее', { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('Из чего сложились очки игрока Хост E2E')).toContainText(
      /Начислений очков нет|Верные тезисы|Выполненные контракты|Верные свойства модели|Полностью раскрытые сигналы|Бонус полной модели/,
    )
    await expect(page.getByRole('heading', { name: 'Конфигурация аномалии' })).toBeVisible()
    await expect(page.getByText('Раскрытые свойства шести сигналов', { exact: true })).toBeVisible()
    await expect(page.getByText('Финальная модель не отправлена')).toHaveCount(0)
    await expect(page.getByText('Аудит по раундам', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 768, height: 1024 })
    await auditCheckpoint(page, '12a-completed-audit-tablet-768x1024')
    await page.setViewportSize({ width: 1440, height: 900 })
    await auditCheckpoint(page, '12-completed-audit-desktop-1440x900')
    await guestPage.setViewportSize({ width: 360, height: 800 })
    await auditCheckpoint(guestPage, '13a-completed-audit-mobile-360x800')
    await guestPage.setViewportSize({ width: 390, height: 844 })
    await auditCheckpoint(guestPage, '13-completed-audit-mobile-390x844')
    const secondRoundAudit = page.locator('details[data-audit-round="2"]')
    await secondRoundAudit.locator('summary').click()
    await expect(secondRoundAudit.getByText('Широкое исследование', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Правила' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Справочник правил' })).toBeVisible()
    await expect(page.getByText('Таймер матча продолжает идти')).toHaveCount(0)
    await page.getByRole('button', { name: 'Закрыть правила' }).click()
    await page.getByRole('button', { name: 'Трактовка анализов' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Трактовка лабораторных анализов' })).toBeVisible()
    await expect(page.getByText('Таймер матча продолжает идти')).toHaveCount(0)
    await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

    await page.getByRole('button', { name: 'Выйти из матча' }).click()
    await expect(page).toHaveURL('/')
    await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
    await expect(
      page.getByText('Сыграно матчей').locator('..').getByText('1', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Завершите первый матч, чтобы появилась статистика.')).toHaveCount(0)
    expect(runtimeIssues).toEqual([])
  } finally {
    await guestContext.close()
  }
})
