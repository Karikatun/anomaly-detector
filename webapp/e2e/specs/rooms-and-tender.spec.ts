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
  await page.getByRole('combobox', { name: 'Сигнал для тезиса' }).selectOption('aster')
  await page.getByRole('combobox', { name: 'Тип поля для тезиса' }).selectOption('inertial')
  await page.getByRole('combobox', { name: 'Полярность для тезиса' }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис' }).click()
}

async function completeContract(page: Page) {
  const contract = page.locator('[data-contract-kind="complex"], [data-contract-kind="light"]').first()
  const reserve = contract.getByRole('button', { name: /^Зарезервировать контракт / })
  const contractId = (await reserve.getAttribute('aria-label'))?.replace('Зарезервировать контракт ', '')
  if (!contractId) throw new Error('Contract identifier is missing')

  await reserve.click()
  await contract.getByRole('button', { name: /→/ }).first().click()
  await contract.getByRole('button', { name: `Подать заявку по контракту ${contractId}` }).click()
}

async function submitFinalModel(page: Page) {
  await page.getByRole('button', { name: 'Aster: тип поля Инерционное' }).click()
  await page.getByRole('button', { name: 'Aster: полярность Позитив' }).click()
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
}

test('requires every lobby player to be ready before enabling the match start', async ({ browser, page }) => {
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

    const startButton = page.getByRole('button', { name: 'Начать игру' })
    await expect(startButton).toBeDisabled()
    await guestPage.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(startButton).toBeDisabled()
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(startButton).toBeEnabled()
    await page.getByRole('button', { name: 'Отменить готовность' }).click()
    await expect(startButton).toBeDisabled()
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
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeDisabled()
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
    await page.getByRole('button', { name: 'Готов', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Начать игру' })).toBeEnabled()

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
    await expect(page.getByText('При равном выборе слот получает игрок по этому приоритету: Хост E2E → Гость E2E.')).toBeVisible()
    await expect(page.getByText('Компенсация: 1 образец сигнала')).toBeVisible()
    await expect(page.getByText('Компенсация: 1 бюджет и 1 образец сигнала')).toBeVisible()

    await chooseAccessSlot(page, 1)
    await expect(page.getByRole('button', { name: 'Выбор принят — ожидаем игроков' })).toBeDisabled()
    await expect(page.getByRole('status')).toContainText('Слот 1: Аварийный зафиксирован и остаётся секретным.')
    await expectPhase(guestPage, headings.access)
    await chooseAccessSlot(guestPage, 2)

    await expectPhase(page, headings.power)
    await expectPhase(guestPage, headings.power)
    await expect(page.getByText('2 мощности: непрерывный опыт с публичным результатом и приватным измерением полярности.')).toBeVisible()
    await expect(page.getByText('2 мощности: сохраните 1 мощность для заявки, если штраф заблокирует другую.')).toBeVisible()
    await expect(page.getByText('Результат выбора слота')).toBeVisible()
    await expect(page.getByText('Вы выбрали слот 1 и получили его.')).toBeVisible()
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
    await expect(page.getByText(/(Инерционное|Электромагнитное|Фазовое) \/ (Позитив \(\+\)|Негатив \(−\))/).first()).toBeVisible()
  } finally {
    await guestContext.close()
  }
})
