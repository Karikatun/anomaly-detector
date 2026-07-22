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

async function runReconnaissance(page: Page) {
  await page.getByRole('button', { name: 'Сигнал для разведки: Boreal' }).click()
  await page.getByRole('button', { name: 'Исследовать' }).click()
}

async function runLaboratory(page: Page) {
  await page.getByRole('button', { name: 'Источник: Aster' }).click()
  await page.getByRole('button', { name: 'Приёмник: Boreal' }).click()
  await page.getByRole('button', { name: 'Провести опыт' }).click()
}

async function submitThesis(page: Page) {
  await page.getByRole('combobox', { name: 'Сигнал для тезиса' }).selectOption('aster')
  await page.getByRole('combobox', { name: 'Тип поля для тезиса' }).selectOption('inertial')
  await page.getByRole('combobox', { name: 'Полярность для тезиса' }).selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис' }).click()
}

async function completeContract(page: Page) {
  const reserve = page.getByRole('button', { name: /^Зарезервировать контракт / }).first()
  const contractId = (await reserve.getAttribute('aria-label'))?.replace('Зарезервировать контракт ', '')
  if (!contractId) throw new Error('Contract identifier is missing')

  await reserve.click()
  await page.getByRole('combobox', { name: `Результат заявки ${contractId}` }).selectOption('attenuation')
  await page.getByRole('combobox', { name: `Бюджет заявки ${contractId}` }).selectOption('1')
  await page.getByRole('button', { name: `Подать заявку по контракту ${contractId}` }).click()
}

async function submitFinalModel(page: Page) {
  await page.getByRole('button', { name: 'Aster: тип поля Инерционное' }).click()
  await page.getByRole('button', { name: 'Aster: полярность Позитив' }).click()
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
}

test('two players complete every Tender stage and receive each realtime phase transition', async ({ browser, page }) => {
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
    await expectPhase(page, headings.access)
    await expectPhase(guestPage, headings.access)
    await expect(page.getByText('При равном выборе слот получает игрок по этому приоритету: Хост E2E → Гость E2E.')).toBeVisible()
    await expect(page.getByText('Компенсация: 1 аналитический отчёт')).toBeVisible()
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
    await allocatePower(page, { 'Разведка': 1, 'Лаборатория': 1, 'Контракты': 2 })
    await expect(page.getByText('Ожидание хода')).toBeVisible()
    await expect(page.getByText('Сейчас действует Гость E2E.')).toBeVisible()
    await allocatePower(guestPage, { 'Разведка': 1, 'Лаборатория': 1, 'Контракты': 2 })

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
      await expect(guestPage.getByRole('button', { name: 'Подтвердить выбор' })).toBeDisabled()

      await expectPhase(page, headings.power)
      await expectPhase(guestPage, headings.power)
      await allocatePower(page, { 'Лаборатория': 2, 'Анализ модели': 2 })
      await allocatePower(guestPage, { 'Лаборатория': 2, 'Анализ модели': 2 })

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
  } finally {
    await guestContext.close()
  }
})
