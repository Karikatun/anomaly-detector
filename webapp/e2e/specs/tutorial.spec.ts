import { expect, registerBrowserUser, test } from '../helpers/test'

const tasks = {
  roundOneRecon: 'Исследуйте Неизвестный сектор, чтобы получить второй Образец.',
  roundOneThesis: 'Отправьте Тезис по Астеру. Тип поля и полярность проверяются отдельно.',
  roundTwoThesis: 'Подтвердите свойства Бореала вторым Тезисом.',
  contractBid: 'Проверьте выбранный опыт и отправьте заявку на контракт.',
} as const

function currentTask(page: Parameters<typeof registerBrowserUser>[0], task: string) {
  return page.getByTestId('floater').getByText(task, { exact: true })
}

async function chooseAccessSlot(page: Parameters<typeof registerBrowserUser>[0], slot: 4 | 5) {
  await page.getByRole('button', { name: new RegExp(`^Слот доступа ${slot}:`) }).click()
  await page.getByRole('button', { name: 'Подтвердить выбор' }).click()
}

async function allocatePower(
  page: Parameters<typeof registerBrowserUser>[0],
  allocation: Record<'Разведка' | 'Лаборатория' | 'Анализ модели' | 'Контракты', number>,
) {
  for (const [category, count] of Object.entries(allocation)) {
    for (let index = 0; index < count; index += 1) {
      await page.getByRole('button', { name: `Увеличить мощность: ${category}` }).click()
    }
  }
  await page.getByRole('button', { name: 'Подтвердить распределение' }).click()
}

async function runReconnaissance(page: Parameters<typeof registerBrowserUser>[0]) {
  await page.getByRole('button', { name: 'Сигнал для разведки: Неизвестный сигнал A' }).click()
  await page.getByRole('button', { name: 'Исследовать' }).click()
}

async function runLaboratoryTest(
  page: Parameters<typeof registerBrowserUser>[0],
  source: 'Aster' | 'Boreal',
  receiver: 'Boreal' | 'Cinder',
  mode?: 'Глубокое',
) {
  if (mode) await page.getByRole('button', { name: mode }).click()
  await page.getByRole('button', { name: `Образец: ${source}` }).click()
  await page.getByRole('button', { name: `Образец: ${receiver}` }).click()
  await page.getByRole('button', { name: `Провести опыт: ${source} → ${receiver}` }).click()
}

async function saveHypothesis(
  page: Parameters<typeof registerBrowserUser>[0],
  signal: 'Aster' | 'Boreal',
  fieldType: 'Инерционное' | 'Электромагнитное',
) {
  const fieldButton = page.getByRole('button', { name: `${signal}: гипотеза, тип поля ${fieldType}` })
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    await page.getByRole('button', { name: 'Рабочая модель' }).click()
  }
  await fieldButton.click()
  await page.getByRole('button', { name: `${signal}: гипотеза, полярность Положительная` }).click()
  const closeWorkingModel = page.getByRole('button', { name: 'Закрыть рабочую модель' })
  if ((page.viewportSize()?.width ?? 0) <= 600) await closeWorkingModel.click()
}

async function submitThesis(
  page: Parameters<typeof registerBrowserUser>[0],
  signal: 'aster' | 'boreal',
  fieldType: 'inertial' | 'electromagnetic',
) {
  await page.getByLabel('Сигнал для тезиса').selectOption(signal)
  await page.getByLabel('Тип поля для тезиса').selectOption(fieldType)
  await page.getByLabel('Полярность для тезиса').selectOption('positive')
  await page.getByRole('button', { name: 'Выдвинуть тезис' }).click()
}

test('completes the two-round tutorial, restores its tab-local step, and records only completion', async ({ page }) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerBrowserUser(page, 'Ученик E2E', 'tutorial-happy')

  await page.getByRole('button', { name: 'ПРОЙТИ ОБУЧЕНИЕ' }).click()
  await expect(page).toHaveURL(/\/tutorial\/?$/)
  await expect(page.getByTestId('overlay')).toBeVisible()
  await chooseAccessSlot(page, 5)
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 2,
    'Анализ модели': 1,
    'Контракты': 0,
  })
  await expect(currentTask(page, tasks.roundOneRecon)).toBeVisible()

  await page.reload()
  await expect(currentTask(page, tasks.roundOneRecon)).toBeVisible()
  await runReconnaissance(page)
  await runLaboratoryTest(page, 'Aster', 'Boreal', 'Глубокое')

  await expect(page.getByRole('button', { name: 'Справка', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Правила', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Трактовка анализов', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Цикл типов поля')
  await page.getByRole('button', { name: 'Закрыть трактовку анализов' }).click()

  await saveHypothesis(page, 'Aster', 'Инерционное')
  await expect(currentTask(page, tasks.roundOneThesis)).toBeVisible()
  await submitThesis(page, 'aster', 'inertial')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Справка', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Правила', exact: true })).toBeHidden()
  await chooseAccessSlot(page, 4)
  await allocatePower(page, {
    'Разведка': 1,
    'Лаборатория': 1,
    'Анализ модели': 1,
    'Контракты': 1,
  })
  await runReconnaissance(page)
  await runLaboratoryTest(page, 'Boreal', 'Cinder')

  await saveHypothesis(page, 'Boreal', 'Электромагнитное')
  await expect(currentTask(page, tasks.roundTwoThesis)).toBeVisible()
  await submitThesis(page, 'boreal', 'electromagnetic')

  await page.getByLabel('Подходящее исследование').selectOption('tutorial-test-2')
  await page.getByRole('button', { name: 'Зарезервировать контракт tutorial-light-contract' }).click()
  await expect(currentTask(page, tasks.contractBid)).toBeVisible()
  await page.getByRole('button', { name: 'Подтвердить контракт tutorial-light-contract' }).click()

  await expect(page.getByLabel('Заполнено параметров: 4')).toBeVisible()
  await page.getByRole('button', { name: 'Отправить финальную модель' }).click()
  await expect(page.getByText('Обучение завершено', { exact: true })).toBeVisible()
  await expect(page.getByText('В обычном Tender пять раундов', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'В ГЛАВНОЕ МЕНЮ' }).click()
  await expect(page.getByRole('button', { name: 'ПОВТОРИТЬ ОБУЧЕНИЕ' })).toBeVisible()
  await page.getByRole('button', { name: 'ПРОФИЛЬ' }).click()
  await expect(
    page.getByText('Сыграно матчей').locator('..').getByText('0', { exact: true }),
  ).toBeVisible()
})

test('blocks a direct tutorial entry while the player has an active room', async ({ page }) => {
  await registerBrowserUser(page, 'Занятый ученик E2E', 'tutorial-blocked')
  await page.getByRole('button', { name: 'СОЗДАТЬ КОМНАТУ' }).click()
  await page.getByLabel('Количество игроков').selectOption('2')
  await page.getByRole('button', { name: 'Создать команду' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)

  await page.goto('/tutorial')
  await expect(page.getByText('Сначала завершите активный Tender', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться в матч' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/?$/)
})
